/**
 * Presentation metadata for the pet-book "vibe" picker (the story's emotional
 * register). Keys mirror PET_VIBES in lib/validation/schemas.ts (and VIBE_RULES
 * in src/anthropic.js). Ordered lightest → most tender, so 'memorial' sits last.
 *
 * Each vibe is a BOOK-CHANGING lever, so every option carries a one-line
 * description of what it does. 'memorial' is framed gently — it's for a family
 * whose pet has passed.
 */
import { PET_VIBES } from '@/lib/validation/schemas';

export interface VibeOption {
  value: (typeof PET_VIBES)[number];
  label: string;
  blurb: string;
}

export const VIBE_OPTIONS: ReadonlyArray<VibeOption> = [
  {
    value: 'happy',
    label: 'Happy moments',
    blurb: 'A joyful, celebratory story: play, cuddles, and everyday delight.',
  },
  {
    value: 'adventure',
    label: 'A fun adventure',
    blurb: 'An imaginative romp where your pet is the brave hero of the tale.',
  },
  {
    value: 'tribute',
    label: 'A tribute',
    blurb: 'A warm love letter to everything that makes them who they are.',
  },
  {
    value: 'memorial',
    label: 'In memory',
    blurb: 'A gentle keepsake for a pet who has passed, to hold onto with love.',
  },
];

/** The memorial label reads "In memory of <name>" when we know the pet's name. */
export function vibeLabel(option: VibeOption, petName: string | null): string {
  if (option.value === 'memorial' && petName) return `In memory of ${petName}`;
  return option.label;
}
