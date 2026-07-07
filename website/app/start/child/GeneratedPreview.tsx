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

const POLL_MS = 1500;
// Must exceed the worker's PREVIEW image budget (fail-fast + retry + 2× hedge,
// ~135s ceiling in src/gemini.js) so the UI never bails MID-RETRY. The worker
// marks the row done/failed at the real outcome; this is just the fallback for a
// worker that never updates the row. (2026-07-07)
const TIMEOUT_MS = 150_000;

type Phase = 'idle' | 'generating' | 'done' | 'failed';

interface Props {
  inputs: RequestPreviewInput;
  /** A chosen photo (already uploaded by CharacterBuilder), or null for the structured path. */
  photo?: { path: string; hash: string } | null;
}

export function GeneratedPreview({ inputs, photo }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  // Sampled bg of the generated image — the box matches it so the character melts
  // in (no seam against the page cream). null → keep the default paper colour.
  const [bgColor, setBgColor] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stop, []); // cleanup polling on unmount

  async function generate() {
    stop();
    setError(null);
    setCached(false);
    setBgColor(null);
    setPhase('generating');
    try {
      const res = await requestPreview({
        ...inputs,
        photoPath: photo?.path,
        photoHash: photo?.hash,
      });
      if (res.status === 'done' && res.imageUrl) {
        setImageUrl(res.imageUrl);
        setBgColor(res.bgColor ?? null);
        setCached(res.cached);
        setPhase('done');
        return;
      }
      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setPhase('failed');
          setError('Our art engine is busy right now — give it another try in a moment. (You haven’t been charged.)');
          return;
        }
        try {
          const s = await getPreviewStatus(res.previewId);
          if (s.status === 'done' && s.imageUrl) {
            setImageUrl(s.imageUrl);
            setBgColor(s.bgColor ?? null);
            setPhase('done');
            return;
          }
          if (s.status === 'failed') {
            setPhase('failed');
            setError('Our art engine is busy right now — give it another try in a moment. (You haven’t been charged.)');
            return;
          }
        } catch {
          /* transient poll error — keep trying until timeout */
        }
        pollRef.current = setTimeout(poll, POLL_MS);
      };
      pollRef.current = setTimeout(poll, POLL_MS);
    } catch {
      setPhase('failed');
      setError('Something went wrong. Try again.');
    }
  }

  const busy = phase === 'generating';

  return (
    <div className="space-y-md">
      {/* Generate — the single action for both the photo and structured paths. */}
      <div className="space-y-sm flex flex-col items-center">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="font-heading bg-iron-oxide px-lg py-sm text-h3 rounded-full text-white italic transition-opacity disabled:opacity-60"
        >
          {busy ? 'Painting…' : phase === 'done' ? '↻ Try another look' : '✨ Preview them (optional)'}
        </button>

        {phase === 'idle' ? (
          <p className="font-body text-warm-grey text-caption italic">
            Optional. See how they’ll look before you continue.
          </p>
        ) : null}
        {phase === 'done' && cached ? (
          <p className="font-body text-warm-grey text-caption italic">
            ✨ Here’s your character (from your saved preview).
          </p>
        ) : null}
        {phase === 'done' && !cached ? (
          <p className="font-body text-warm-grey text-caption">
            A painted preview. Your book places them in the story.
          </p>
        ) : null}
        {phase === 'failed' && error ? (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {/* Paper card — the (empty until generated) result surface */}
      <div
        className="border-warm-grey-light p-sm rounded-2xl border"
        style={{ backgroundColor: '#fdfbef', boxShadow: '0 2px 14px rgba(120,90,60,.10)' }}
      >
        <div
          className="relative aspect-[11/6] w-full overflow-hidden rounded-xl transition-colors"
          style={{ backgroundColor: bgColor ?? '#fdfbef' }}
        >
          {imageUrl && (phase === 'done' || phase === 'generating') ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote signed Supabase URL
            <img src={imageUrl} alt="Your character" className="h-full w-full object-contain" />
          ) : null}

          {phase === 'idle' && !imageUrl ? (
            <div className="text-warm-grey p-md flex h-full w-full items-center justify-center text-center">
              <p className="font-body text-caption italic">
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
