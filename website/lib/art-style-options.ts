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
   * W-E rollout gate: a style is PURCHASABLE once its per-style page-vocab is
   * tuned + validated on a full book and shipped to the worker. As of 2026-07-06
   * five are purchasable (watercolour, coloured_pencil, painterly, ink_wash,
   * cutpaper); flat_modern stays previewable-but-not-purchasable (the flat idiom
   * genericizes the child's face at the sheet stage — likeness can't survive).
   * Visitors can preview any style; checkout is gated to purchasable ones
   * (create-checkout-session).
   */
  purchasable: boolean;
}

export const STYLE_OPTIONS: ReadonlyArray<ArtStyleOption> = [
  { value: 'watercolour', label: 'Watercolour', blurb: 'Soft washes, warm and gentle.', purchasable: true },
  // coloured_pencil flipped purchasable 2026-07-06 (W-E): per-style medium tokens +
  // edge-fill emphasis shipped to the worker (72bf374), validated on a full pencil book.
  { value: 'coloured_pencil', label: 'Coloured Pencil', blurb: 'Textured strokes, hand-drawn warmth.', purchasable: true },
  // painterly flipped purchasable 2026-07-06 (W-E): painterly medium fills shipped
  // to the worker (c055807), validated on a full oil-painting book.
  { value: 'painterly', label: 'Painterly', blurb: 'Rich golden-age storybook oils.', purchasable: true },
  // ink_wash flipped purchasable 2026-07-06 (W-E): ink & wash medium fills +
  // NO_FRAME_EMPHASIS shipped to the worker (f037d45), validated on a full book.
  { value: 'ink_wash', label: 'Ink & Wash', blurb: 'Loose linework, atmospheric washes.', purchasable: true },
  { value: 'flat_modern', label: 'Flat Modern', blurb: 'Clean shapes, bold modern flats.', purchasable: false },
  // cutpaper flipped purchasable 2026-07-06 (W-E): cut-paper medium fills + BOTH
  // EDGE_FILL_EMPHASIS + NO_FRAME_EMPHASIS + likeness lever shipped to the worker
  // (0befd3c), validated on a full 12-page book — face stayed smooth-rendered +
  // specific on all 12 despite the collage medium.
  { value: 'cutpaper', label: 'Cut-Paper Collage', blurb: 'Layered paper, playful texture.', purchasable: true },
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
// reference a sample asset that hasn't been harvested yet. The preview-only style
// (flat_modern) shows only its swatch.
export const STYLES_WITH_SAMPLE = ['watercolour', 'coloured_pencil', 'painterly', 'ink_wash', 'cutpaper'] as const;

/** Whether the style has an example-page asset to show in the picker. */
export function hasStyleSample(value: string): boolean {
  return (STYLES_WITH_SAMPLE as readonly string[]).includes(value);
}

/** Static /public path of the style's example PAGE (same Mila scene per style, so
 *  the picker is a true medium comparison). Only valid when hasStyleSample(value). */
export function styleSample(value: string): string {
  return `/samples/art-style/${value}.webp`;
}
