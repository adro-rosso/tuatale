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
}

export const STYLE_OPTIONS: ReadonlyArray<ArtStyleOption> = [
  { value: 'watercolour', label: 'Watercolour', blurb: 'Soft washes, warm and gentle.' },
  { value: 'coloured_pencil', label: 'Coloured Pencil', blurb: 'Textured strokes, hand-drawn warmth.' },
  { value: 'painterly', label: 'Painterly', blurb: 'Rich golden-age storybook oils.' },
  { value: 'ink_wash', label: 'Ink & Wash', blurb: 'Loose linework, atmospheric washes.' },
  { value: 'flat_modern', label: 'Flat Modern', blurb: 'Clean shapes, bold modern flats.' },
  { value: 'cutpaper', label: 'Cut-Paper Collage', blurb: 'Layered paper, playful texture.' },
];

/** Static /public path of the style's swatch portrait. */
export function styleThumb(value: string): string {
  return `/style-thumbs/${value}.png`;
}
