'use client';

/**
 * The "painting your character" progress bar (S-D). Gemini gives no true %, so this
 * is a TIME-ESTIMATE: an ease-out fill to ~90% over ~12s, held there, then snapped
 * to 100% when `done`. Staged craft copy makes the wait read as painting, not a
 * spinner. After ~20s (API-incident reality) the copy shifts to reassurance; the
 * hard timeout + retry live in the parent (GeneratedPreview).
 */
import { useEffect, useState } from 'react';

const STAGES: { until: number; text: string }[] = [
  { until: 3000, text: 'Mixing the paints…' },
  { until: 7000, text: 'Sketching their face…' },
  { until: 12000, text: 'Painting their hair…' },
  { until: 20000, text: 'Adding the finishing touches…' },
  { until: Infinity, text: 'Taking a little longer than usual — hang tight ✨' },
];

const stageFor = (ms: number) => (STAGES.find((s) => ms < s.until) ?? STAGES[STAGES.length - 1])!.text;

export function PreviewProgress({ done, photo }: { done: boolean; photo?: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (done) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 120);
    return () => clearInterval(id);
  }, [done]);

  // ease-out to ~90% over ~12s; 100% only when done.
  const pct = done ? 100 : Math.min(90, (1 - Math.exp(-elapsed / 5500)) * 100);
  const copy = done ? 'Ready!' : stageFor(elapsed);

  return (
    <div className="space-y-sm w-full" role="status" aria-live="polite">
      <div className="bg-cream-deep h-2 w-full overflow-hidden rounded-full">
        <div
          className="bg-iron-oxide h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-body text-warm-grey text-caption text-center italic">
        {photo ? 'Painting their likeness — ' : ''}{copy}
      </p>
    </div>
  );
}
