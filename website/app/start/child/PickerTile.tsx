'use client';

/**
 * One character-picker option (Slice 3). Reuses GeneratedPreview's paper-card + bgColor
 * melt-in. Each tile shows its OWN status so options appear as each lands (not all-or-
 * nothing). A `done` tile is pickable; a `failed` one is quietly skipped (never an error —
 * the picker is non-blocking). `selected` gives the chosen tile a warm ring.
 */
import type { PreviewStatus } from '@/lib/preview/types';

interface Props {
  status: PreviewStatus;
  imageUrl?: string | null;
  bgColor?: string | null;
  selected?: boolean;
  name: string;
  onPick?: () => void;
  /** Resume/stale: the chosen image failed to load (expired preview) → tell the parent. */
  onImageError?: () => void;
}

export function PickerTile({ status, imageUrl, bgColor, selected, name, onPick, onImageError }: Props) {
  const done = status === 'done' && Boolean(imageUrl);
  const failed = status === 'failed';

  const inner = (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden rounded-xl transition-colors"
      style={{ backgroundColor: bgColor ?? '#fffdf8' }}
    >
      {done ? (
        // Uniform grid framing (display-only): object-cover + top anchor crops every option
        // to the SAME head-anchored frame, so the tiles read as one set (compare faces, not
        // framing) regardless of residual mint scale/crop drift. The STORED sheet is the full
        // image; only the tile display is normalized.
        // eslint-disable-next-line @next/next/no-img-element -- remote signed Supabase URL
        <img src={imageUrl!} alt={`${name} option`} onError={onImageError} className="h-full w-full object-cover object-top" />
      ) : null}

      {failed ? (
        <div className="text-warm-grey p-sm flex h-full w-full items-center justify-center text-center">
          <p className="font-body text-caption">This one didn’t paint. The others are fine to choose.</p>
        </div>
      ) : null}

      {!done && !failed ? (
        // Calm skeleton only — the batch shows ONE shared progress bar (in CharacterPicker),
        // so tiles no longer each render their own bar (was 3 identical bars at once).
        <div className="absolute inset-0 animate-pulse" style={{ backgroundColor: 'rgba(253,251,239,.55)' }} aria-hidden />
      ) : null}

      {selected ? (
        <div className="bg-iron-oxide text-cream absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-caption shadow-[0_2px_8px_rgba(120,90,60,0.25)]" aria-hidden>
          ✓
        </div>
      ) : null}
    </div>
  );

  const cardBase =
    'border bg-paper p-xs rounded-2xl shadow-[0_8px_30px_rgba(120,90,60,0.08)] transition-all';
  const ring = selected
    ? 'border-iron-oxide ring-2 ring-iron-oxide/60'
    : 'border-warm-grey-light/70 hover:border-iron-oxide/60';

  if (done && onPick) {
    return (
      <button
        type="button"
        onClick={onPick}
        aria-pressed={selected}
        aria-label={`Choose this look for ${name}`}
        className={`${cardBase} ${ring} block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-iron-oxide`}
      >
        {inner}
      </button>
    );
  }
  return <div className={`${cardBase} ${selected ? ring : 'border-warm-grey-light/70'}`}>{inner}</div>;
}
