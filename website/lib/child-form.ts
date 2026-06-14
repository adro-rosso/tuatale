/**
 * Child-step form helpers — pure, framework-free. These live OUTSIDE the
 * 'use server' action module (submit-child.ts) because Next.js requires
 * server-action files to export only async functions; these sync helpers
 * (+ the flat form-values shape) would break that contract and the page
 * that imports featuresToFormValues. Imported by submit-child.ts (action),
 * ChildForm.tsx (type), and page.tsx (flatten).
 *
 * Wizard solicits IDENTITY axes only (hair colour/style, skin tone, eye colour,
 * build, glasses). Outfit + marks were pulled from the wizard 2026-06-11 after
 * the validation-book review (outfit picker fought free-text outfit; mole
 * de-emphasis missed the bar). The contract still CARRIES outfit/marks
 * valid-if-present (childFeaturesSchema + the pipeline injectOutfit/
 * composeMarkClause stay dormant); the form just doesn't write them. Outfit +
 * mark nuance now flows through the free-text "anything else" field.
 */
import type { ChildFeaturesInput } from '@/lib/validation/schemas';

export interface ChildFormValues {
  name: string;
  age_range: string;
  gender: string;
  appearance: string;
  // Structured IDENTITY axes — flat for form round-tripping ('' = unset).
  hair_colour: string;
  hair_style: string;
  skin_tone: string;
  eye_colour: string;
  glasses: string;
  build: string;
}

export const STRUCTURED_KEYS = [
  'hair_colour', 'hair_style', 'skin_tone', 'eye_colour', 'glasses', 'build',
] as const;

/** Build the nested child_features blob from the flat form values (omit empties). */
export function buildChildFeatures(v: ChildFormValues): ChildFeaturesInput | undefined {
  const f: Record<string, unknown> = {};
  for (const k of STRUCTURED_KEYS) {
    if (v[k]) f[k] = v[k];
  }
  return Object.keys(f).length ? (f as ChildFeaturesInput) : undefined;
}

/** Flatten a stored child_features blob back into the flat form fields. */
export function featuresToFormValues(features: unknown): Pick<ChildFormValues, (typeof STRUCTURED_KEYS)[number]> {
  const f = (features ?? {}) as Record<string, unknown>;
  const s = (val: unknown): string => (typeof val === 'string' ? val : '');
  return {
    hair_colour: s(f.hair_colour),
    hair_style: s(f.hair_style),
    skin_tone: s(f.skin_tone),
    eye_colour: s(f.eye_colour),
    glasses: s(f.glasses),
    build: s(f.build),
  };
}
