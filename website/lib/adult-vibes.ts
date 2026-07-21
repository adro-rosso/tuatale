/**
 * Presentation metadata for the adult-book "vibe" picker (the story's register).
 * Keys mirror ADULT_VIBES in lib/validation/schemas.ts, the ADULT_VIBES table in
 * src/anthropic.js (buildAdultVibeRulesBlock), and the ADULT_DEDICATIONS table in
 * src/front-matter.js — keep all four in sync.
 *
 * For adult books the vibe implies different SUBJECT MATTER, not just tone over one
 * premise (unlike pets), so each blurb hints at what kind of story it makes. Each is a
 * BOOK-CHANGING lever, so every option carries a one-line description.
 */
import { ADULT_VIBES } from '@/lib/validation/schemas';

export interface AdultVibeOption {
  value: (typeof ADULT_VIBES)[number];
  label: string;
  blurb: string;
}

export const ADULT_VIBE_OPTIONS: ReadonlyArray<AdultVibeOption> = [
  {
    value: 'romantic',
    label: 'Romantic',
    blurb: 'A warm, personal love story — the small intimacies of a life shared.',
  },
  {
    value: 'milestone',
    label: 'Milestone',
    blurb: 'A birthday, retirement, or new chapter — looking back, and forward.',
  },
  {
    value: 'roast',
    label: 'Affectionate roast',
    blurb: 'Funny and teasing, and fundamentally loving — their quirks, celebrated.',
  },
  {
    value: 'adventure',
    label: 'Adventure',
    blurb: 'An imaginative romp with a grown-up at its centre.',
  },
];
