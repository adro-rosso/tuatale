'use client';

/**
 * Pre-purchase cover UI (Batch 4a Phase 1). Calls getCoverPreview() on mount, polls the
 * existing getPreviewStatus if a fresh render is queued, then paints the customer's
 * character in a cover frame with a title overlay (band plate + Fredoka, mirroring the
 * printed cover). Continue is ALWAYS available — a disabled flag, no cover source, or a
 * render failure all fall back to the original pass-through copy, never blocking the step.
 *
 * "Try another" re-rolls a fresh stochastic render (child fresh-render covers only) reusing
 * the same generation path + cost guards; it keeps the current cover visible while painting
 * and, on failure, keeps the current cover — it never blanks the step or blocks Continue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCoverPreview } from '@/app/start/_actions/cover';
import type { CoverPreviewResult } from '@/lib/cover/types';
import { getPreviewStatus } from '@/app/start/_actions/preview';
import { advanceStep } from '@/app/start/_actions/navigation';
import { balanceTitleLines } from '@/lib/cover/title';
import { Body } from '@/components/ui/Body';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const POLL_MS = 1500;
const TIMEOUT_MS = 150_000; // matches the preview UI ceiling (worker fail-fast + hedge)

type Phase = 'loading' | 'painting' | 'done' | 'passthrough';

interface Props {
  /** next/font Fredoka variable class from the server page, so var(--font-fredoka) resolves. */
  fontClassName: string;
}

export function CoverPreview({ fontClassName }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [cover, setCover] = useState<CoverPreviewResult | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every load()/unmount so a stale in-flight poll (from a prior run or a
  // superseded re-roll) can detect it's been cancelled and stop touching state.
  const runIdRef = useRef(0);

  const load = useCallback(async (regenerate: boolean) => {
    const myRun = ++runIdRef.current;
    const stale = () => runIdRef.current !== myRun;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    // Only the re-roll (button) path needs a synchronous state reset; the initial mount
    // already starts in 'loading' with no error, so it does NO synchronous setState here
    // (that would be a cascading-render in the effect). Its first setState lands post-await.
    if (regenerate) {
      setRegenError(false);
      setRegenerating(true);
    }

    // Show the new image (mount OR re-roll both land here).
    const applyImage = (url: string, bg?: string | null) => {
      setImageUrl(url);
      setBgColor(bg ?? null);
      setPhase('done');
      setRegenerating(false);
    };
    // No cover this attempt. On a re-roll, KEEP the current cover (just flag the miss); on
    // the initial load, fall back to the pass-through. Never blocks Continue either way.
    const fail = () => {
      setRegenerating(false);
      if (regenerate) {
        setRegenError(true);
        setPhase('done');
      } else {
        setPhase('passthrough');
      }
    };

    let res: CoverPreviewResult;
    try {
      res = await getCoverPreview(regenerate ? { regenerate: true } : undefined);
    } catch {
      if (!stale()) fail(); // getCoverPreview soft-fails, but guard anyway
      return;
    }
    if (stale()) return;
    setCover(res);

    if (!res.enabled || res.status === 'none') return void fail();
    if (res.status === 'done' && res.imageUrl) return void applyImage(res.imageUrl, res.bgColor);
    if (!res.previewId) return void fail();

    // Fresh render queued — poll the existing preview row until done/failed/timeout.
    if (!regenerate) setPhase('painting');
    const previewId = res.previewId;
    const startedAt = Date.now();
    const poll = async () => {
      if (stale()) return;
      if (Date.now() - startedAt > TIMEOUT_MS) return void fail();
      try {
        const s = await getPreviewStatus(previewId);
        if (stale()) return;
        if (s.status === 'done' && s.imageUrl) return void applyImage(s.imageUrl, s.bgColor);
        if (s.status === 'failed') return void fail();
      } catch {
        /* transient poll error — keep trying until timeout */
      }
      pollRef.current = setTimeout(poll, POLL_MS);
    };
    pollRef.current = setTimeout(poll, POLL_MS);
  }, []);

  useEffect(() => {
    // Fetch-on-mount kickoff. load()'s state updates land post-await (or only on the
    // re-roll path), not synchronously in this effect — the rule over-flags the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
    return () => {
      // Bump the run id so any in-flight poll's stale() check stops it setting state after
      // unmount; also clear the scheduled poll. (Mutating the ref in cleanup is intentional.)
      runIdRef.current++;
      const timer = pollRef.current;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const advance = advanceStep.bind(null, 'preview');
  const lines = cover ? balanceTitleLines(cover.title) : [];
  const showCover = phase === 'done' || phase === 'painting' || phase === 'loading';

  return (
    <div className={`space-y-lg mx-auto max-w-[40rem] ${fontClassName}`}>
      {phase === 'passthrough' ? (
        <Card variant="paper" className="p-xl text-center">
          <Body className="text-warm-grey">
            A glimpse of the finished book lands here: your character on the cover, in your chosen
            style. If it&apos;s not ready this time, don&apos;t worry — continue straight through and
            we&apos;ll craft the full book after you order.
          </Body>
        </Card>
      ) : (
        <div className="space-y-sm">
          <div className="border-warm-grey-light/70 bg-paper p-sm rounded-2xl border shadow-[0_8px_30px_rgba(120,90,60,0.10)]">
            <div
              className="relative w-full overflow-hidden rounded-xl"
              style={{ aspectRatio: '11 / 8.5', backgroundColor: bgColor ?? '#fffdf8' }}
            >
              {phase === 'done' && imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote signed Supabase URL */}
                  <img src={imageUrl} alt="Your book cover" className="h-full w-full object-contain" />
                  {/* Title band — mirrors the printed cover's band treatment; legible on any image. */}
                  <div
                    className="absolute inset-x-[7%] bottom-[6%] rounded-[22px] px-6 pt-4 pb-5 text-center"
                    style={{
                      background:
                        'linear-gradient(to bottom, rgba(248,242,227,0.97), rgba(242,233,212,0.97))',
                      boxShadow: '0 12px 34px rgba(44,30,14,.28), 0 2px 7px rgba(44,30,14,.18)',
                    }}
                  >
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-[#A2825F]">
                      A Tuatale Book
                    </p>
                    <h2
                      className="leading-none text-[#2B1A0D]"
                      style={{
                        fontFamily: 'var(--font-fredoka), var(--font-fraunces), sans-serif',
                        fontWeight: 700,
                        fontSize: 'clamp(20px, 4.6vw, 34px)',
                      }}
                    >
                      {lines.map((l, i) => (
                        <span key={i} className="block">
                          {l}
                        </span>
                      ))}
                    </h2>
                    {cover?.subtitle ? (
                      <p className="mt-1.5 text-sm italic text-[#7A5636]">{cover.subtitle}</p>
                    ) : null}
                  </div>
                </>
              ) : (
                // Painting / loading state inside the cover frame.
                <div className="text-warm-grey p-md flex h-full w-full items-center justify-center text-center">
                  <p className="font-body text-caption">
                    {phase === 'loading' ? 'Preparing your cover…' : 'Painting your cover…'}
                  </p>
                </div>
              )}

              {/* Re-roll overlay — keep the current cover visible while a new one paints. */}
              {regenerating ? (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(253,251,239,.72)' }}
                >
                  <p className="font-body text-warm-grey text-caption">Painting a new cover…</p>
                </div>
              ) : null}
            </div>
          </div>

          {phase === 'done' ? (
            <div className="space-y-xs text-center">
              <p className="font-body text-warm-grey text-caption">
                A glimpse of your cover. The finished book is crafted after you order.
              </p>
              {/* "Try another" — only for a fresh (stochastic) render; a reused pick has nothing
                  to re-roll. Non-blocking; a failed re-roll keeps the current cover. */}
              {cover?.canRegenerate && showCover ? (
                <div className="space-y-xs">
                  <button
                    type="button"
                    onClick={() => void load(true)}
                    disabled={regenerating}
                    className="font-body text-iron-oxide text-caption border-iron-oxide/40 px-md py-xs hover:bg-cream-deep inline-flex items-center gap-1 rounded-full border font-semibold transition-colors disabled:opacity-60"
                  >
                    {regenerating ? 'Painting…' : '↻ Try another cover'}
                  </button>
                  {regenError ? (
                    <p className="font-body text-warm-grey text-caption" role="status">
                      Couldn&apos;t paint a new one just now — keeping this cover. Try again in a moment.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <form action={advance} className="flex justify-end">
        <Button type="submit" variant="primary">
          Continue →
        </Button>
      </form>
    </div>
  );
}
