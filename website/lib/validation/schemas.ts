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
} as const;

export const AGE_RANGES = ['3-5', '5-7', '7-9'] as const;
export const GENDERS = ['boy', 'girl', 'non_binary'] as const;
export const SUBJECT_TYPES = ['human', 'non_human'] as const;

export const childSchema = z.object({
  name: z.string().min(1, COPY.REQUIRED).max(50, COPY.TOO_LONG),
  age_range: z.enum(AGE_RANGES, { message: COPY.CHOOSE_ONE }),
  gender: z.enum(GENDERS, { message: COPY.CHOOSE_ONE }),
  appearance: z.string().min(50, COPY.TOO_SHORT).max(500, COPY.AT_UPPER),
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

export const themeSchema = z.object({
  theme: z.string().min(20, COPY.TOO_SHORT).max(500, COPY.AT_UPPER),
  theme_template_id: z.string().optional(),
});

export type ThemeInput = z.infer<typeof themeSchema>;

// Re-export the error copy so tests can assert against the canonical
// strings rather than retyping them. Internal use only — UI copy lives
// in the components themselves.
export const VALIDATION_COPY = COPY;
