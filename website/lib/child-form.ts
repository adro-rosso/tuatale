/**
 * Child-step form helpers — pure, framework-free. These live OUTSIDE the
 * 'use server' action module (submit-child.ts) because Next.js requires
 * server-action files to export only async functions; these sync helpers
 * (+ the flat form-values shape) would break that contract and the page
 * that imports featuresToFormValues. Imported by submit-child.ts (action),
 * ChildForm.tsx (type), and page.tsx (flatten).
 */
import type { ChildFeaturesInput } from '@/lib/validation/schemas';

export interface ChildFormValues {
  name: string;
  age_range: string;
  gender: string;
  appearance: string;
  // Structured features — flat for form round-tripping ('' = unset).
  hair_colour: string;
  hair_style: string;
  skin_tone: string;
  eye_colour: string;
  glasses: string;
  build: string;
  outfit_tee: string;
  outfit_shorts: string;
  outfit_shoes: string;
  mark_type: string;
  mark_side: string;
}

export const STRUCTURED_KEYS = [
  'hair_colour', 'hair_style', 'skin_tone', 'eye_colour', 'glasses', 'build',
  'outfit_tee', 'outfit_shorts', 'outfit_shoes', 'mark_type', 'mark_side',
] as const;

/** Build the nested child_features blob from the flat form values (omit empties). */
export function buildChildFeatures(v: ChildFormValues): ChildFeaturesInput | undefined {
  const f: Record<string, unknown> = {};
  for (const k of ['hair_colour', 'hair_style', 'skin_tone', 'eye_colour', 'glasses', 'build'] as const) {
    if (v[k]) f[k] = v[k];
  }
  const outfit: Record<string, string> = {};
  if (v.outfit_tee) outfit.tee = v.outfit_tee;
  if (v.outfit_shorts) outfit.shorts = v.outfit_shorts;
  if (v.outfit_shoes) outfit.shoes = v.outfit_shoes;
  if (Object.keys(outfit).length) f.outfit = outfit;
  if (v.mark_type && v.mark_side) f.marks = [{ type: v.mark_type, side: v.mark_side, region: 'cheek' }];
  return Object.keys(f).length ? (f as ChildFeaturesInput) : undefined;
}

/** Flatten a stored child_features blob back into the flat form fields. */
export function featuresToFormValues(features: unknown): Pick<ChildFormValues, (typeof STRUCTURED_KEYS)[number]> {
  const f = (features ?? {}) as Record<string, unknown>;
  const outfit = (f.outfit ?? {}) as Record<string, unknown>;
  const mark = (Array.isArray(f.marks) ? f.marks[0] : undefined) as Record<string, unknown> | undefined;
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    hair_colour: s(f.hair_colour),
    hair_style: s(f.hair_style),
    skin_tone: s(f.skin_tone),
    eye_colour: s(f.eye_colour),
    glasses: s(f.glasses),
    build: s(f.build),
    outfit_tee: s(outfit.tee),
    outfit_shorts: s(outfit.shorts),
    outfit_shoes: s(outfit.shoes),
    mark_type: s(mark?.type),
    mark_side: s(mark?.side),
  };
}
