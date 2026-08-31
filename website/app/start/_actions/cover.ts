'use server';

/**
 * Pre-purchase cover ("see a glimpse") server action — Batch 4a Phase 1.
 *
 * Resolves the cover IMAGE for the caller's own draft with NO new worker code:
 *   1. Reuse the picker's chosen character image ($0 — the common case once the picker
 *      is on): re-sign a fresh URL from its stored bucket path.
 *   2. Else, for a CHILD → fire the existing requestPreview with the SAME inputs the
 *      character step used — INCLUDING the uploaded photo (photoPath+photoHash) when one
 *      exists, so the cover cache-hits that photo-anchored preview instead of minting a
 *      generic structured character. A cache hit is $0; a fresh mint is ~$0.04, bounded by
 *      the existing per-draft cap + rate-limit.
 *   3. Else (pet/adult with no pick) → NO cover source we can render cheaply without
 *      misrendering, so return 'none' and the page falls back to the pass-through.
 *
 * GATED by COVER_PREVIEW_ENABLED (server-only, fail-closed, never NEXT_PUBLIC): off →
 * enabled:false → the page stays today's pass-through. NEVER throws — any failure returns
 * a 'none'/pass-through result so Continue is never blocked. No worker change; GA untouched.
 */
import { randomUUID } from 'node:crypto';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { getDraftByCookieId } from '@/db/drafts';
import { createServerClient } from '@/lib/supabase';
import { requestPreview, requestCoverScene, getChosenSheet } from '@/app/start/_actions/preview';
import { deriveCoverTitle } from '@/lib/cover/title';
import type { RequestPreviewInput } from '@/lib/preview/types';
import type { CoverPreviewResult } from '@/lib/cover/types';

export interface CoverPreviewOptions {
  /** "Try another" — force a fresh stochastic render (bypass the chosen-pick reuse + the
   *  input-hash cache via a unique variant). Counts against the existing per-draft cap. */
  regenerate?: boolean;
}

const PREVIEW_BUCKET = 'tuatale-previews';
const COVER_URL_TTL_SECONDS = 60 * 60; // 1h — long enough for a cover-viewing session

const OFF: CoverPreviewResult = { enabled: false, status: 'none', title: '', subtitle: null };

/**
 * The child reference photo, if one was uploaded (CHILD_PHOTO_ENABLED). uploadPhoto persists
 * it at draft.photo_urls.child[0] as `uploads/<draftId>/<sha256>.png` — and the filename stem
 * IS the content hash the preview cache keys on (computeInputHash → `photo: photoHash`). So
 * deriving the hash here makes the cover's input hash MATCH the character step's photo-anchored
 * preview → a $0 cache hit on the EXACT image the customer just saw. If the hash can't be
 * derived we still pass photoPath (a correct photo-anchored mint, just not cache-aligned).
 */
function childPhoto(draft: Record<string, unknown>): { path: string; hash?: string } | null {
  const child = (draft.photo_urls as { child?: string[] } | null)?.child;
  const path = Array.isArray(child) ? child[0] : undefined;
  if (!path) return null;
  return { path, hash: path.match(/\/([a-f0-9]{64})\.png$/i)?.[1] };
}

/**
 * Build the child requestPreview input from the draft columns. Anchors on the SAME source of
 * truth the character step showed: when a photo was uploaded, include photoPath + photoHash so
 * the cover renders that child's likeness (matching the ✨ preview) — NOT a generic structured
 * character. No photo → the structured build, as before.
 */
function buildChildCoverInput(draft: Record<string, unknown>): RequestPreviewInput {
  const photo = childPhoto(draft);
  return {
    draftId: String(draft.id),
    name: (draft.child_name as string | null) ?? undefined,
    age: (draft.child_age as number | null) ?? 6, // cosmetic default; age drives the cache key
    gender: (draft.child_gender as string | null) ?? undefined,
    features: (draft.child_features as Record<string, string> | null) ?? undefined,
    freeText: (draft.child_appearance as string | null) ?? undefined,
    background: (draft.background as string | null) ?? undefined,
    style: draft.art_style as string,
    isAdult: false,
    photoPath: photo?.path,
    photoHash: photo?.hash,
  };
}

export async function getCoverPreview(opts?: CoverPreviewOptions): Promise<CoverPreviewResult> {
  // Fail-closed gate — the REAL control (a Server Action id ships in the client bundle, so
  // "the page doesn't call it" is not a control). Off → byte-identical to no cover.
  if (process.env.COVER_PREVIEW_ENABLED !== 'on') return OFF;
  const regenerate = opts?.regenerate === true;

  try {
    const cookieId = await getDraftCookieFromRequest();
    if (!cookieId) return { ...OFF, enabled: true };
    const draft = (await getDraftByCookieId(cookieId)) as Record<string, unknown> | null;
    if (!draft) return { ...OFF, enabled: true };

    const { title, subtitle } = deriveCoverTitle({
      childName: draft.child_name as string | null,
      bookType: draft.book_type as string | null,
      themeTemplateId: draft.theme_template_id as string | null,
    });

    // 0. Phase 2 — COVER_SCENE_ENABLED (server-only, fail-closed, default OFF): render the
    //    character in a full in-style cover SCENE (not a portrait), anchored on the same
    //    source Phase 1 uses. Child books only for now. On any block (capped/rate-limited/
    //    unavailable) fall THROUGH to the Phase-1 portrait path below — never blocks Continue.
    if (process.env.COVER_SCENE_ENABLED === 'on' && (draft.book_type as string) === 'child') {
      const scene = await requestCoverScene({ regenerate });
      if (scene.status === 'done' && scene.imageUrl) {
        return { enabled: true, status: 'done', imageUrl: scene.imageUrl, bgColor: scene.bgColor ?? null, title, subtitle, canRegenerate: true };
      }
      if (scene.previewId) {
        return { enabled: true, status: scene.status, previewId: scene.previewId, title, subtitle, canRegenerate: true };
      }
      // blocked → fall through to Phase 1.
    }

    // 1. Reuse the picker's chosen image ($0). Re-sign fresh from the stored path so an
    //    expired pick-time signed URL never breaks the cover. SKIPPED on a "try another" —
    //    the chosen pick is a fixed image with nothing to re-roll; a re-roll wants a fresh mint.
    if (!regenerate) {
      const chosen = await getChosenSheet('protagonist');
      if (chosen && !chosen.degraded && (chosen.imagePath || chosen.imageUrl)) {
        let url = chosen.imageUrl ?? null;
        if (chosen.imagePath) {
          const { data } = await createServerClient()
            .storage.from(PREVIEW_BUCKET)
            .createSignedUrl(chosen.imagePath, COVER_URL_TTL_SECONDS);
          if (data?.signedUrl) url = data.signedUrl;
        }
        // canRegenerate:false — it's their chosen look; re-roll belongs in the picker.
        if (url) return { enabled: true, status: 'done', imageUrl: url, bgColor: null, title, subtitle, canRegenerate: false };
      }
    }

    // 2. Child → fresh render via the existing preview rails, anchored on the photo when one
    //    was uploaded (else the structured build). Same inputs as the character step, so a
    //    cache hit returns the exact image the customer just saw.
    //    (Pet/adult are NOT fresh-rendered here: the single-preview path is built for a
    //    human subject and would misrender a pet — they rely on the picker's chosen image.)
    if ((draft.book_type as string) === 'child') {
      const input = buildChildCoverInput(draft);
      // "Try another" → a unique variant busts the input-hash cache for a genuine new dice
      // roll (each re-roll a fresh render); the existing per-draft cap + rate-limit apply.
      if (regenerate) input.variant = `cover:${randomUUID()}`;
      const res = await requestPreview(input);
      if (res.status === 'done' && res.imageUrl) {
        return { enabled: true, status: 'done', imageUrl: res.imageUrl, bgColor: res.bgColor ?? null, title, subtitle, canRegenerate: true };
      }
      if (res.previewId) {
        return { enabled: true, status: res.status, previewId: res.previewId, title, subtitle, canRegenerate: true };
      }
      // Blocked (capped / rate-limited) → no cheap cover this visit → pass-through.
      return { enabled: true, status: 'none', title, subtitle };
    }

    // 3. Pet/adult with no pick → no cheap, faithful cover source → pass-through.
    return { enabled: true, status: 'none', title, subtitle };
  } catch (err) {
    // Never let the cover step crash — the customer keeps a working Continue.
    console.error('[getCoverPreview] soft-fail:', err instanceof Error ? err.message : String(err));
    return { ...OFF, enabled: true };
  }
}
