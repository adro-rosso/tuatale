'use client';

import { useActionState, useState } from 'react';
import { submitStyleStep, type SubmitStyleState } from '@/app/start/_actions/submit-style';
import { STYLE_OPTIONS, styleThumb, hasStyleSample, styleSample } from '@/lib/art-style-options';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';

interface StyleFormProps {
  /** The draft's saved art_style (or the watercolour default for a fresh draft). */
  initial: string;
  /** 'child' | 'pet' — pet serves the Biscuit tiles + hides the child example page. */
  bookType: string;
}

const initialState: SubmitStyleState = { errors: {} };

/**
 * The art-style picker. A radio grid of swatches (the style-probe portraits) —
 * one selected at a time, default watercolour. The chosen value rides a hidden
 * input into the server action, which persists draft.art_style and advances to
 * the character step (where previews render in this style).
 */
export function StyleForm({ initial, bookType }: StyleFormProps) {
  const [state, formAction, isPending] = useActionState(submitStyleStep, initialState);
  const [selected, setSelected] = useState<string>(initial);
  void state; // the picker always submits a valid value; no field errors to show

  // Derive the "available to order now" copy from the purchasable set, so it never
  // goes stale as styles are flipped purchasable (W-E rollout).
  const purchasableLabels = STYLE_OPTIONS.filter((o) => o.purchasable).map((o) => o.label);
  const purchasableCount = purchasableLabels.length;
  const purchasableList =
    purchasableCount <= 1
      ? purchasableLabels[0] ?? ''
      : `${purchasableLabels.slice(0, -1).join(', ')} and ${purchasableLabels[purchasableCount - 1]}`;

  // Match each tile's background to its thumbnail's own paper colour so the swatch
  // melts into the tile (no rectangle seam against the page cream). Thumbnails are
  // same-origin (/style-thumbs), so the canvas isn't tainted. Mean of the 4 source
  // corners, sampled on image load.
  const [bgByValue, setBgByValue] = useState<Record<string, string>>({});
  const sampleCorner = (value: string, img: HTMLImageElement) => {
    try {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return;
      const s = Math.max(1, Math.floor(Math.min(nw, nh) * 0.06));
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      let r = 0, g = 0, b = 0;
      const corners: ReadonlyArray<readonly [number, number]> = [[0, 0], [nw - s, 0], [0, nh - s], [nw - s, nh - s]];
      for (const [x, y] of corners) {
        ctx.drawImage(img, x, y, s, s, 0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        r += d[0] ?? 0; g += d[1] ?? 0; b += d[2] ?? 0;
      }
      setBgByValue((prev) => ({ ...prev, [value]: `rgb(${Math.round(r / 4)}, ${Math.round(g / 4)}, ${Math.round(b / 4)})` }));
    } catch {
      /* sampling failed → keep the default paper colour */
    }
  };

  return (
    <form action={formAction} className="space-y-lg">
      <input type="hidden" name="art_style" value={selected} />

      <div className="gap-md tablet:grid-cols-3 grid grid-cols-2">
        {STYLE_OPTIONS.map((opt) => {
          const checked = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              aria-pressed={checked}
              className={`p-xs group flex flex-col rounded-xl border-2 text-left transition-colors ${
                checked
                  ? 'border-iron-oxide bg-cream-deep'
                  : 'border-warm-grey-light bg-cream hover:border-iron-oxide'
              }`}
              // Once the thumbnail loads, its sampled paper colour overrides the
              // class bg so the swatch melts into the tile (selection = the border).
              style={{ backgroundColor: bgByValue[opt.value] }}
            >
              <span
                className={`relative block aspect-square w-full overflow-hidden rounded-lg ${
                  checked ? 'ring-iron-oxide ring-2' : ''
                }`}
                style={{ backgroundColor: bgByValue[opt.value] ?? '#fdfbef' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static /public swatch */}
                <img
                  src={styleThumb(opt.value, bookType)}
                  alt={`${opt.label} sample`}
                  onLoad={(e) => sampleCorner(opt.value, e.currentTarget)}
                  className="h-full w-full object-cover"
                />
                {/* Preview-only styles are previewable but not purchasable. As of
                    2026-07-06 only flat_modern remains preview-only (the flat idiom
                    can't hold the child's specific likeness — see art-style-options). */}
                {!opt.purchasable && (
                  <span className="bg-near-black/70 px-xs py-3xs absolute right-1 top-1 rounded font-body text-[10px] uppercase tracking-wide text-cream">
                    Preview only
                  </span>
                )}
              </span>
              <span className="px-xs pt-sm font-heading text-near-black text-h3 not-italic">
                {opt.label}
              </span>
              <span className="px-xs pb-xs font-body text-warm-grey text-caption">
                {opt.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {/* Example page for the SELECTED style — shown only for the purchasable,
          page-vocab-tuned styles (watercolour + coloured pencil). Same Mila scene
          per style, so a parent sees the medium difference, not the scene. */}
      {hasStyleSample(selected) && bookType !== 'pet' && (
        <figure className="border-warm-grey-light bg-paper mx-auto max-w-[26rem] overflow-hidden rounded-xl border shadow-[0_8px_30px_rgba(120,90,60,0.08)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static /public sample */}
          <img
            src={styleSample(selected)}
            alt={`A sample book page in the ${STYLE_OPTIONS.find((o) => o.value === selected)?.label ?? selected} style`}
            className="block w-full"
          />
          <figcaption className="px-sm py-xs font-body text-warm-grey text-caption text-center">
            A sample book page in this style.
          </figcaption>
        </figure>
      )}

      <Body size="caption">
        Every page of the book is painted in the style you pick here. You can change it any time
        before you order. {purchasableList} {purchasableCount === 1 ? 'is' : 'are'} available to
        order now; the other styles are preview-only while we perfect them.
      </Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
