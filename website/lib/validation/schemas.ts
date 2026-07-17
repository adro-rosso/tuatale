/**
 * Zod schemas for the wizard form steps.
 *
 * The error messages match the brand's warm-literary voice — short,
 * never officious. Keep them in sync with the field-level UI copy.
 *
 * Schemas mirror (and tighten) the Postgres CHECK constraints from
 * supabase/migrations/. The DB is the ultimate guard; Zod gives us
 * fast client + server validation with friendly messages before any
 * write hits Supabase.
 */
import { z } from 'zod';

// Brand-voice error copy. Reused across schemas.
const COPY = {
  REQUIRED: "We'll need this.",
  TOO_SHORT: 'A little more detail would help.',
  TOO_LONG: 'A little shorter would help.',
  AT_UPPER: "That's plenty.",
  CHOOSE_ONE: 'Please choose one.',
  RELATIONSHIP_REQUIRED: 'Who are they to your child?',
  APPEARANCE_OR_BUILD: 'Build their character above, or tell us in 50+ characters.',
  HAIR_STYLE_NOT_FOR_BOYS: "That style isn't available for boys yet.",
} as const;

export const AGE_RANGES = ['3-5', '5-7', '7-9'] as const;
export const GENDERS = ['boy', 'girl', 'non_binary'] as const;
export const SUBJECT_TYPES = ['human', 'non_human'] as const;

// ---- Structured character features (Spec: structured inputs, 2026-06-11) -------
// These enums MIRROR the canonical contract in src/character-features.js
// (FEATURE_VALUES / OUTFIT_VALUES / MARK_VALUES / HAIR_STYLE_BY_GENDER). The
// production Zod can't import the root src/ module without breaking the website's
// build (cross-rootDir), so the values are mirrored here and a vitest parity test
// (feature-contract-parity.test.ts) imports the canonical constants and asserts
// EXACT equality — any drift fails CI.
export const HAIR_COLOURS = ['black', 'dark-brown', 'brown', 'light-brown', 'dark-blonde', 'blonde', 'auburn', 'red'] as const;
export const HAIR_STYLES = ['buzzed', 'short', 'short-curly', 'tousled', 'coily-afro', 'shoulder-length', 'long', 'ponytail', 'pigtails', 'braids', 'bun', 'bald'] as const;
export const BOY_HAIR_STYLES = ['buzzed', 'short', 'short-curly', 'tousled', 'coily-afro', 'bald'] as const;
export const SKIN_TONES = ['porcelain', 'fair', 'light', 'medium-olive', 'tan', 'brown', 'deep-brown'] as const;
export const EYE_COLOURS = ['dark-brown', 'brown', 'hazel', 'green', 'blue', 'grey'] as const;
export const BUILDS = ['slight', 'average', 'sturdy'] as const;
export const GLASSES_VALUES = ['yes', 'no'] as const;
export const TEE_COLOURS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'white', 'grey'] as const;
export const SHORTS_COLOURS = ['denim-blue', 'navy', 'khaki', 'grey', 'black', 'forest'] as const;
export const SHOES = ['white-sneakers', 'red-sneakers', 'blue-sneakers', 'black', 'brown-boots'] as const;
export const MARK_TYPES = ['mole', 'birthmark', 'scar'] as const;
export const MARK_SIDES = ['left', 'right'] as const;

// Art style (W-C). MIRRORS src/art-styles.js STYLE_VALUES — kept in sync by the
// style-contract-parity test (production Zod can't import the root src module).
// The wizard picker (W-F) consumes artStyleSchema; default = watercolour.
export const STYLE_VALUES = [
  'watercolour', 'coloured_pencil', 'painterly', 'ink_wash', 'flat_modern', 'cutpaper',
] as const;
export const artStyleSchema = z.enum(STYLE_VALUES).default('watercolour');

// Reading level (prose difficulty). MIRRORS the pipeline keys in src/anthropic.js
// READING_LEVELS (simplest / standard / advanced) — kept in sync by a static
// parity assertion in the schema test (production Zod can't import the root src
// module). Controls PROSE only; the child's age still drives the character visual.
// OPTIONAL by design: the wizard writes a concrete value ONLY when the parent
// overrides the age-derived default. Untouched → undefined → stored NULL → the
// worker's resolveReadingLevel derives the level from the age band.
export const READING_LEVEL_VALUES = ['simplest', 'standard', 'advanced'] as const;
export type ReadingLevel = (typeof READING_LEVEL_VALUES)[number];
export const readingLevelSchema = z.enum(READING_LEVEL_VALUES).optional();
// Age band → default reading level (mirrors src/anthropic.js BAND_TO_LEVEL). The
// wizard uses this to show the age-derived default highlight; the worker remains
// the source of truth for the actual default when reading_level is NULL.
export const READING_LEVEL_BY_BAND: Record<string, ReadingLevel> = {
  '3-5': 'simplest',
  '5-7': 'standard',
  '7-9': 'advanced',
};
// Reverse map: a directly-picked reading level → a representative age band. Used
// for PET books, where the reader may be any age (child or adult owner), so we
// don't ask for an age — the parent picks the reading level directly and we keep
// age_range populated (from this map) for the downstream columns/pipeline.
export const READING_LEVEL_TO_BAND: Record<ReadingLevel, (typeof AGE_RANGES)[number]> = {
  simplest: '3-5',
  standard: '5-7',
  advanced: '7-9',
};

// Optional custom dedication (front-matter). Blank → the auto-default
// "For {name}, with love" renders. Trimmed; ~120-char cap (one short line on
// the dedication page). Placement-independent: whatever step collects it uses
// this schema. Empty string normalises to undefined (treated as "use default").
export const DEDICATION_MAX = 120;
export const dedicationMessageSchema = z
  .string()
  .trim()
  .max(DEDICATION_MAX, COPY.TOO_LONG)
  .optional()
  .transform((v) => (v ? v : undefined));

// Optional child background / heritage (the parent's own words, e.g. "Nigerian",
// "mixed Korean and Irish"). Threaded into composeAppearance; the system-prompt
// HERITAGE frame governs faithful, dignified rendering. Blank → undefined.
export const BACKGROUND_MAX = 120;
export const backgroundSchema = z
  .string()
  .trim()
  .max(BACKGROUND_MAX, COPY.TOO_LONG)
  .optional()
  .transform((v) => (v ? v : undefined));

// The 4 identity axes that make a character "structured-complete" (Adro 2026-06-11).
export const STRUCTURED_COMPLETE_AXES = ['hair_colour', 'hair_style', 'skin_tone', 'eye_colour'] as const;

export const markSchema = z.object({
  type: z.enum(MARK_TYPES, { message: COPY.CHOOSE_ONE }),
  side: z.enum(MARK_SIDES, { message: COPY.CHOOSE_ONE }),
  region: z.literal('cheek').default('cheek'), // v1: cheek only
});

export const childFeaturesSchema = z.object({
  hair_colour: z.enum(HAIR_COLOURS).optional(),
  hair_style: z.enum(HAIR_STYLES).optional(),
  skin_tone: z.enum(SKIN_TONES).optional(),
  eye_colour: z.enum(EYE_COLOURS).optional(),
  glasses: z.enum(GLASSES_VALUES).optional(),
  build: z.enum(BUILDS).optional(),
  outfit: z
    .object({
      tee: z.enum(TEE_COLOURS).optional(),
      shorts: z.enum(SHORTS_COLOURS).optional(),
      shoes: z.enum(SHOES).optional(),
    })
    .optional(),
  marks: z.array(markSchema).max(1).optional(), // v1: at most one mark
});

export type ChildFeaturesInput = z.infer<typeof childFeaturesSchema>;

// "Structured-complete" = the 4 identity axes present. Accepts a loose shape so
// callers can pass a stored child_features blob (Json) as well as a parsed input.
export function isStructuredComplete(f: unknown): boolean {
  const ff = f as Record<string, unknown> | null | undefined;
  return !!(ff && ff.hair_colour && ff.hair_style && ff.skin_tone && ff.eye_colour);
}

export const childSchema = z
  .object({
    name: z.string().min(1, COPY.REQUIRED).max(50, COPY.TOO_LONG),
    age_range: z.enum(AGE_RANGES, { message: COPY.CHOOSE_ONE }),
    gender: z.enum(GENDERS, { message: COPY.CHOOSE_ONE }),
    // Free text is now OPTIONAL + additive — the requirement is satisfied by EITHER
    // a structured-complete character OR a 50+ char description (see superRefine).
    appearance: z.string().max(500, COPY.AT_UPPER).optional(),
    features: childFeaturesSchema.optional(),
  })
  .superRefine((data, ctx) => {
    // Gender-gate (renderability): boys may only use the restricted hair_style set.
    const hs = data.features?.hair_style;
    if (hs && data.gender === 'boy' && !(BOY_HAIR_STYLES as readonly string[]).includes(hs)) {
      ctx.addIssue({
        code: 'custom',
        path: ['features', 'hair_style'],
        message: COPY.HAIR_STYLE_NOT_FOR_BOYS,
      });
    }
    // Requirement: structured-complete OR free-text >= 50 chars.
    const freeOk = (data.appearance?.trim().length ?? 0) >= 50;
    if (!isStructuredComplete(data.features) && !freeOk) {
      ctx.addIssue({
        code: 'custom',
        path: ['appearance'],
        message: COPY.APPEARANCE_OR_BUILD,
      });
    }
  });

export type ChildInput = z.infer<typeof childSchema>;

export const secondarySchema = z
  .object({
    name: z.string().min(1, COPY.REQUIRED).max(50, COPY.TOO_LONG),
    subject_type: z.enum(SUBJECT_TYPES, { message: COPY.CHOOSE_ONE }),
    gender: z.enum(GENDERS).optional(),
    relationship: z.string().min(1, COPY.RELATIONSHIP_REQUIRED).max(80, COPY.TOO_LONG),
    appearance: z.string().min(30, COPY.TOO_SHORT).max(300, COPY.AT_UPPER),
    extra_care: z.boolean().default(false),
    // Storage paths — a companion's photos drive their likeness (first photo is
    // the adapter's photoPath anchor). Pet books only; adults/pets, never a child.
    photos: z.array(z.string()).max(5).optional(),
  })
  // Gender is REQUIRED for human secondaries (matches the schema's
  // CHECK + matches the pipeline's gender-marker requirement). Non-human
  // secondaries (pets / toys) don't have gender; the field stays absent.
  .refine((data) => data.subject_type !== 'human' || data.gender !== undefined, {
    message: COPY.CHOOSE_ONE,
    path: ['gender'],
  });

export type SecondaryInput = z.infer<typeof secondarySchema>;

export const secondariesArraySchema = z
  .array(secondarySchema)
  .max(3, 'Up to three companions for now.');

export type SecondariesInput = z.infer<typeof secondariesArraySchema>;

// ---- Pet-as-hero (book_type='pet') ---------------------------------------------
// The book's protagonist type. 'child' = the existing product; 'pet' = a pet hero
// (owner appears as a companion). Mirrors drafts/orders.book_type (default 'child').
export const BOOK_TYPES = ['child', 'pet'] as const;
export type BookType = (typeof BOOK_TYPES)[number];
export const bookTypeSchema = z.enum(BOOK_TYPES).default('child');

// A pet protagonist. No gender; identity is species/breed (animal_kind) + a coat/
// markings description + photos (persisted separately to draft.photo_urls). age_range
// is the READER's band (drives reading level), not the pet's age.
export const ANIMAL_KIND_MAX = 40;
export const petSchema = z.object({
  name: z.string().min(1, COPY.REQUIRED).max(50, COPY.TOO_LONG),
  // A pet book's reader can be a child OR an adult owner, so there's no age
  // question — the parent picks the reading level DIRECTLY (default standard).
  // submit-pet derives a representative age_range from this (READING_LEVEL_TO_BAND).
  reading_level: z.enum(READING_LEVEL_VALUES).default('standard'),
  // Species/breed, free text (e.g. "golden retriever", "tabby cat", "rabbit").
  animal_kind: z.string().min(1, COPY.REQUIRED).max(ANIMAL_KIND_MAX, COPY.TOO_LONG),
  // Coat/markings description — the likeness spine alongside the photos. 30+ chars.
  appearance: z.string().min(30, COPY.TOO_SHORT).max(500, COPY.AT_UPPER),
});
export type PetInput = z.infer<typeof petSchema>;

// Pet-book "vibe" — the story's emotional register (pet books only). These keys
// MIRROR the VIBES table in src/anthropic.js (buildVibeRulesBlock); keep the two in
// sync. 'memorial' is for a pet who has passed — handled with dignity.
export const PET_VIBES = ['happy', 'adventure', 'tribute', 'memorial'] as const;
export type PetVibe = (typeof PET_VIBES)[number];
export const petVibeSchema = z.enum(PET_VIBES).optional();

export const themeSchema = z.object({
  theme: z.string().min(20, COPY.TOO_SHORT).max(500, COPY.AT_UPPER),
  theme_template_id: z.string().optional(),
  // Optional; set only for pet books. Steers story tone (see anthropic.js VIBE_RULES).
  vibe: petVibeSchema,
});

export type ThemeInput = z.infer<typeof themeSchema>;

// Re-export the error copy so tests can assert against the canonical
// strings rather than retyping them. Internal use only — UI copy lives
// in the components themselves.
export const VALIDATION_COPY = COPY;
