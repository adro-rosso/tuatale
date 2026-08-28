'use server';

/**
 * Pre-purchase cover ("see a glimpse") server action — Batch 4a Phase 1.
 *
 * Resolves the cover IMAGE for the caller's own draft with NO new worker code:
 *   1. Reuse the picker's chosen character image ($0 — the common case once the picker
 *      is on): re-sign a fresh URL from its stored bucket path.
 *   2. Else, for a CHILD (structured, no photo) → fire the existing requestPreview
 *      (same guards / input-hash cache / poll rails). A cache hit is $0; a fresh mint is
 *      ~$0.04, bounded by the existing per-draft cap + rate-limit.
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
import { requestPreview, getChosenSheet } from '@/app/start/_actions/preview';
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

/** Build the child (structured, no-photo) requestPreview input from the draft columns. */
function buildChildCoverInput(draft: Record<string, unknown>): RequestPreviewInput {
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

    // 2. Child (structured, no photo) → fresh render via the existing preview rails.
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
