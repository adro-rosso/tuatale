/**
 * Presentation metadata for the art-style picker (W-F). One entry per
 * STYLE_VALUES key — the parity test (style-contract-parity) asserts this
 * list covers exactly the validated style values, so the picker can never
 * drift from the schema / the pipeline's source of truth.
 *
 * The thumbnail is the style-probe portrait copied into /public/style-thumbs
 * (same child, same pose, each style) so the swatches are a true comparison.
 */
import { STYLE_VALUES } from '@/lib/validation/schemas';

export type ArtStyleValue = (typeof STYLE_VALUES)[number];

export interface ArtStyleOption {
  value: ArtStyleValue;
  label: string;
  blurb: string;
  /**
   * MIN-SAFE rollout (W-E gate): only watercolour is book-grade today, so it is
   * the only PURCHASABLE style. The other five are previewable-but-not-purchasable
   * until their per-style page-vocab is tuned (W-E, needs real gens). Visitors can
   * preview any style; checkout is gated to purchasable ones (create-checkout-session).
   */
  purchasable: boolean;
}

export const STYLE_OPTIONS: ReadonlyArray<ArtStyleOption> = [
  { value: 'watercolour', label: 'Watercolour', blurb: 'Soft washes, warm and gentle.', purchasable: true },
  // coloured_pencil flipped purchasable 2026-07-06 (W-E): per-style medium tokens +
  // edge-fill emphasis shipped to the worker (72bf374), validated on a full pencil book.
  { value: 'coloured_pencil', label: 'Coloured Pencil', blurb: 'Textured strokes, hand-drawn warmth.', purchasable: true },
  { value: 'painterly', label: 'Painterly', blurb: 'Rich golden-age storybook oils.', purchasable: false },
  { value: 'ink_wash', label: 'Ink & Wash', blurb: 'Loose linework, atmospheric washes.', purchasable: false },
  { value: 'flat_modern', label: 'Flat Modern', blurb: 'Clean shapes, bold modern flats.', purchasable: false },
  { value: 'cutpaper', label: 'Cut-Paper Collage', blurb: 'Layered paper, playful texture.', purchasable: false },
];

/** Whether a style value may be PURCHASED (not just previewed). Unknown → false. */
export function isPurchasableStyle(value: string | null | undefined): boolean {
  return STYLE_OPTIONS.some((o) => o.value === value && o.purchasable);
}

/** Static /public path of the style's swatch portrait (the small tile image). */
export function styleThumb(value: string): string {
  return `/style-thumbs/${value}.png`;
}

// Styles with a rendered EXAMPLE PAGE for the picker — the purchasable, page-vocab-
// tuned styles. Kept explicit (not derived from `purchasable`) so a future flip can't
// reference a sample asset that hasn't been harvested yet. The 4 preview-only styles
// show only their swatch until each is tuned + shipped.
export const STYLES_WITH_SAMPLE = ['watercolour', 'coloured_pencil'] as const;

/** Whether the style has an example-page asset to show in the picker. */
export function hasStyleSample(value: string): boolean {
  return (STYLES_WITH_SAMPLE as readonly string[]).includes(value);
}

/** Static /public path of the style's example PAGE (same Mila scene per style, so
 *  the picker is a true medium comparison). Only valid when hasStyleSample(value). */
export function styleSample(value: string): string {
  return `/samples/art-style/${value}.webp`;
}
