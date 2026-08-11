'use client';

/**
 * The "painting your character" progress bar (S-D). Gemini gives no true %, so the fill is a
 * blend of two signals, whichever is further along:
 *   (a) a slow time-estimate creep tuned to the REAL ~150s ceiling — it keeps inching and
 *       never sits frozen at 90% (the old ~12s-to-90% curve stalled for ~2 min); and
 *   (b) when the caller knows real completion (the picker: N of 3 options have landed),
 *       the actual fraction — so the bar reflects reality as tiles finish.
 * Snaps to 100% on `done`. Staged craft copy makes the wait read as painting, not a spinner.
 * The hard timeout + retry live in the parent (GeneratedPreview / CharacterPicker).
 */
import { useEffect, useState } from 'react';

const STAGES: { until: number; text: string }[] = [
  { until: 4000, text: 'Mixing the paints…' },
  { until: 15000, text: 'Sketching their face…' },
  { until: 40000, text: 'Painting their hair…' },
  { until: 80000, text: 'Adding the finishing touches…' },
  { until: Infinity, text: 'Almost there — thanks for your patience ✨' },
];

const stageFor = (ms: number) => (STAGES.find((s) => ms < s.until) ?? STAGES[STAGES.length - 1])!.text;

export function PreviewProgress({
  done,
  photo,
  completed,
  total,
}: {
  done: boolean;
  photo?: boolean;
  /** Real progress signal (optional): how many sub-items have landed, out of `total`. */
  completed?: number;
  total?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (done) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 150);
    return () => clearInterval(id);
  }, [done]);

  // Slow ease-out toward ~90% over the real ~150s horizon (never a frozen 90%-at-12s).
  const timeCreep = Math.min(90, (1 - Math.exp(-elapsed / 45000)) * 100);
  // If the caller knows real completion, let it pull the bar forward.
  const realFrac = total && total > 0 && completed != null ? (completed / total) * 100 : 0;
  const pct = done ? 100 : Math.max(timeCreep, realFrac);
  const copy = done ? 'Ready!' : stageFor(elapsed);

  return (
    <div className="space-y-sm w-full" role="status" aria-live="polite">
      <div className="bg-cream-deep h-2 w-full overflow-hidden rounded-full">
        <div
          className="bg-iron-oxide h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-body text-warm-grey text-caption text-center">
        {photo ? 'Painting their likeness. ' : ''}
        {copy}
      </p>
    </div>
  );
}
