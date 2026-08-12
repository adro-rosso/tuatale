'use client';

/**
 * Pre-purchase cover UI (Batch 4a Phase 1). Calls getCoverPreview() on mount, polls the
 * existing getPreviewStatus if a fresh render is queued, then paints the customer's
 * character in a cover frame with a title overlay (band plate + Fredoka, mirroring the
 * printed cover). Continue is ALWAYS available — a disabled flag, no cover source, or a
 * render failure all fall back to the original pass-through copy, never blocking the step.
 */
import { useEffect, useRef, useState } from 'react';
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
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };

    (async () => {
      let res: CoverPreviewResult;
      try {
        res = await getCoverPreview();
      } catch {
        if (!cancelled) setPhase('passthrough'); // getCoverPreview soft-fails, but guard anyway
        return;
      }
      if (cancelled) return;
      setCover(res);

      if (!res.enabled || res.status === 'none') {
        setPhase('passthrough');
        return;
      }
      if (res.status === 'done' && res.imageUrl) {
        setImageUrl(res.imageUrl);
        setBgColor(res.bgColor ?? null);
        setPhase('done');
        return;
      }
      if (!res.previewId) {
        setPhase('passthrough');
        return;
      }

      // Fresh render queued — poll the existing preview row until done/failed/timeout.
      setPhase('painting');
      const previewId = res.previewId;
      const startedAt = Date.now();
      const poll = async () => {
        if (cancelled) return;
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setPhase('passthrough');
          return;
        }
        try {
          const s = await getPreviewStatus(previewId);
          if (cancelled) return;
          if (s.status === 'done' && s.imageUrl) {
            setImageUrl(s.imageUrl);
            setBgColor(s.bgColor ?? null);
            setPhase('done');
            return;
          }
          if (s.status === 'failed') {
            setPhase('passthrough');
            return;
          }
        } catch {
          /* transient poll error — keep trying until timeout */
        }
        pollRef.current = setTimeout(poll, POLL_MS);
      };
      pollRef.current = setTimeout(poll, POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const advance = advanceStep.bind(null, 'preview');
  const lines = cover ? balanceTitleLines(cover.title) : [];

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
            </div>
          </div>
          {phase === 'done' ? (
            <p className="font-body text-warm-grey text-caption text-center">
              A glimpse of your cover. The finished book is crafted after you order.
            </p>
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
