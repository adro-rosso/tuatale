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
  { value: 'coloured_pencil', label: 'Coloured Pencil', blurb: 'Textured strokes, hand-drawn warmth.', purchasable: false },
  { value: 'painterly', label: 'Painterly', blurb: 'Rich golden-age storybook oils.', purchasable: false },
  { value: 'ink_wash', label: 'Ink & Wash', blurb: 'Loose linework, atmospheric washes.', purchasable: false },
  { value: 'flat_modern', label: 'Flat Modern', blurb: 'Clean shapes, bold modern flats.', purchasable: false },
  { value: 'cutpaper', label: 'Cut-Paper Collage', blurb: 'Layered paper, playful texture.', purchasable: false },
];

/** Whether a style value may be PURCHASED (not just previewed). Unknown → false. */
export function isPurchasableStyle(value: string | null | undefined): boolean {
  return STYLE_OPTIONS.some((o) => o.value === value && o.purchasable);
}

/** Static /public path of the style's swatch portrait. */
export function styleThumb(value: string): string {
  return `/style-thumbs/${value}.png`;
}
