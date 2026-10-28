'use client';

/**
 * The character window's result surface (S-D). The user provides inputs above
 * (a photo, or the structured features), then presses "✨ Generate my character"
 * → ONE whole-character mint (requestPreview → poll getPreviewStatus) → the
 * painted result. Cache hits return instantly (no progress bar, no spend).
 *
 * S-F: the old cut-out part-hotspots are gone (meaningless with whole-character
 * generation). Photo state now lives in CharacterBuilder (the photo path is the
 * hero); this component just receives the chosen photo and feeds it to the mint.
 */
import { useEffect, useRef, useState } from 'react';
import { requestPreview, getPreviewStatus } from '@/app/start/_actions/preview';
import type { RequestPreviewInput } from '@/lib/preview/types';
import { PreviewProgress } from './PreviewProgress';
import { buttonClasses } from '@/components/ui/Button';

const POLL_MS = 1500;
// Must exceed the worker's PREVIEW image budget (fail-fast + retry + 2× hedge,
// ~135s ceiling in src/gemini.js) so the UI never bails MID-RETRY. The worker
// marks the row done/failed at the real outcome; this is just the fallback for a
// worker that never updates the row. (2026-07-07)
const TIMEOUT_MS = 150_000;
// One SILENT auto-retry after the first busy/timeout: Gemini stalls are transient,
// so a second attempt either cache-hits an Inngest-recovered image or lands a fresh
// shot — no manual re-click. Exactly ONE retry (a real sustained outage still ends
// on "busy — try again"; never loops). Short delay so a just-recovering mint can
// settle before the retry re-requests. (2026-07-07)
const RETRY_DELAY_MS = 3_000;
const BUSY_MSG =
  'Our art engine is busy right now — give it another try in a moment. (You haven’t been charged.)';
const CAPPED_MSG =
  'That’s all the free previews for this book. Your characters are still painted in full after you order.';

type Phase = 'idle' | 'generating' | 'done' | 'failed';

// crypto.randomUUID needs a secure context (missing over plain http on a LAN IP, and in
// Safari before 15.4); the variant only has to be unique per draft, so fall back.
const randomId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

interface Props {
  inputs: RequestPreviewInput;
  /** A chosen photo (already uploaded by CharacterBuilder), or null for the structured path. */
  photo?: { path: string; hash: string } | null;
  /** Shown after a preview: how to steer the next one. Only where the steering ALSO reaches
   *  the book (the structured path's description); a photo preview never feeds the book. */
  refineHint?: string;
}

export function GeneratedPreview({ inputs, photo, refineHint }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  // Sampled bg of the generated image — the box matches it so the character melts
  // in (no seam against the page cream). null → keep the default paper colour.
  const [bgColor, setBgColor] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether this user-initiated generate has already spent its ONE silent retry.
  const autoRetriedRef = useRef(false);
  // "Try another look" must be a NEW dice roll: identical inputs hit the input-hash cache
  // and handed back the same image (Adro, 2026-10). A re-roll of the image on screen gets a
  // fresh variant (a distinct cache slot); a first preview of any inputs uses the plain key,
  // so a returning parent, or one who changes a feature and back, gets the saved image free.
  // In a ref so the silent auto-retry re-requests the SAME variant.
  const variantRef = useRef<string | undefined>(undefined);
  // Which inputs the image on screen was painted from, and which the in-flight request uses.
  const paintedKeyRef = useRef<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  // The image on screen, readable from the async request path (a failed re-roll keeps it).
  const imageUrlRef = useRef<string | null>(null);

  const stop = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stop, []); // cleanup polling on unmount

  // User action: a fresh generate resets the one-silent-retry budget.
  function generate() {
    autoRetriedRef.current = false;
    const key = JSON.stringify({ ...inputs, photoHash: photo?.hash ?? null });
    if (key !== paintedKeyRef.current) variantRef.current = undefined; // new inputs: plain key
    else if (phase === 'done') variantRef.current = `reroll:${randomId()}`; // re-roll this look
    // else: same inputs after a failure → retry the same request
    requestKeyRef.current = key;
    void runPreview();
  }

  function show(url: string, bg: string | null, fromCache: boolean) {
    imageUrlRef.current = url;
    paintedKeyRef.current = requestKeyRef.current;
    setImageUrl(url);
    setBgColor(bg);
    setCached(fromCache);
    setPhase('done');
  }

  // A failed attempt never blanks the step: if an image is on screen, keep it and say why.
  function giveUp(message: string) {
    setPhase(imageUrlRef.current ? 'done' : 'failed');
    setError(message);
  }

  async function runPreview() {
    stop();
    setError(null);
    setCached(false);
    setBgColor(null);
    setPhase('generating');

    // First busy/timeout → spend the one silent retry (stay 'generating', no flash);
    // second busy → land on "busy — try again".
    const onBusy = () => {
      if (!autoRetriedRef.current) {
        autoRetriedRef.current = true;
        pollRef.current = setTimeout(() => void runPreview(), RETRY_DELAY_MS);
        return;
      }
      giveUp(BUSY_MSG);
    };

    try {
      const res = await requestPreview({
        ...inputs,
        photoPath: photo?.path,
        photoHash: photo?.hash,
        variant: variantRef.current,
      });
      if (res.status === 'done' && res.imageUrl) {
        show(res.imageUrl, res.bgColor ?? null, res.cached);
        return;
      }
      // Out of free previews: say so plainly (no silent retry; it would only be refused again).
      if (res.blocked === 'capped') {
        giveUp(CAPPED_MSG);
        return;
      }
      // Blocked (rate-limited / no draft) → no previewId to poll → treat as busy.
      if (!res.previewId) {
        onBusy();
        return;
      }
      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          onBusy();
          return;
        }
        try {
          const s = await getPreviewStatus(res.previewId);
          if (s.status === 'done' && s.imageUrl) {
            show(s.imageUrl, s.bgColor ?? null, false);
            return;
          }
          if (s.status === 'failed') {
            onBusy();
            return;
          }
        } catch {
          /* transient poll error — keep trying until timeout */
        }
        pollRef.current = setTimeout(poll, POLL_MS);
      };
      pollRef.current = setTimeout(poll, POLL_MS);
    } catch {
      // Hard error from requestPreview (e.g. network) — also gets the one silent retry.
      onBusy();
    }
  }

  const busy = phase === 'generating';

  return (
    <div className="space-y-md">
      {/* Generate — the single action for both the photo and structured paths. */}
      <div className="space-y-sm flex flex-col items-center">
        <button type="button" onClick={generate} disabled={busy} className={buttonClasses('primary', 'md')}>
          {busy ? 'Painting…' : phase === 'done' ? '↻ Try another look' : '✨ Preview them (optional)'}
        </button>

        {phase === 'idle' ? (
          <p className="font-body text-warm-grey text-caption">
            Optional. See how they’ll look before you continue.
          </p>
        ) : null}
        {phase === 'done' && cached && !error ? (
          <p className="font-body text-warm-grey text-caption">
            ✨ Here’s your character (from your saved preview).
          </p>
        ) : null}
        {phase === 'done' && !cached && !error ? (
          <p className="font-body text-warm-grey text-caption">
            A painted preview. Your book places them in the story.
          </p>
        ) : null}
        {phase === 'done' && refineHint ? (
          <p className="font-body text-near-black text-caption max-w-[26rem] text-center">{refineHint}</p>
        ) : null}
        {phase !== 'generating' && error ? (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {/* Paper card — the (empty until generated) result surface */}
      <div className="border-warm-grey-light/70 bg-paper p-sm rounded-2xl border shadow-[0_8px_30px_rgba(120,90,60,0.08)]">
        <div
          className="relative aspect-[11/6] w-full overflow-hidden rounded-xl transition-colors"
          style={{ backgroundColor: bgColor ?? '#fffdf8' }}
        >
          {imageUrl && (phase === 'done' || phase === 'generating') ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote signed Supabase URL
            <img src={imageUrl} alt="Your character" className="h-full w-full object-contain" />
          ) : null}

          {phase === 'idle' && !imageUrl ? (
            <div className="text-warm-grey p-md flex h-full w-full items-center justify-center text-center">
              <p className="font-body text-caption">
                Set their features above, then preview them here. Totally optional.
              </p>
            </div>
          ) : null}

          {busy ? (
            <div
              className="bg-cream/70 p-md absolute inset-0 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(253,251,239,.72)' }}
            >
              <div className="w-3/4 max-w-[260px]">
                <PreviewProgress done={false} photo={Boolean(photo)} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
