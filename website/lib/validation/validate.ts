/**
 * Validation helpers — thin wrappers around Zod's safeParse that flatten
 * the result into a UI-friendly shape:
 *
 *   { ok: true, data: T }                 — parsed cleanly, data is typed
 *   { ok: false, errors: FieldErrors }    — flat field-path → first-error map
 *
 * UI components read errors as `errors['name']`, `errors['appearance']`,
 * etc. — first error per field, no array. Multi-error display would
 * complicate the inline-below-field UX without much benefit.
 */
import type { z, ZodType } from 'zod';
import {
  childSchema,
  petSchema,
  adultSchema,
  secondariesArraySchema,
  themeSchema,
  type ChildInput,
  type PetInput,
  type AdultInput,
  type SecondariesInput,
  type ThemeInput,
} from './schemas';

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/**
 * Flatten a Zod issue list into the field-path → first-error map.
 *
 * Paths use dot notation for nested fields (e.g. `1.gender` for the
 * second secondary's gender field). Array indexes pass through as
 * strings — `0`, `1`, `2`.
 */
function flattenIssues(issues: z.core.$ZodIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!(path in errors)) {
      errors[path] = issue.message;
    }
  }
  return errors;
}

function validate<T extends ZodType>(schema: T, data: unknown): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: flattenIssues(result.error.issues) };
}

export function validateChild(data: unknown): ValidationResult<ChildInput> {
  return validate(childSchema, data);
}

export function validatePet(data: unknown): ValidationResult<PetInput> {
  return validate(petSchema, data);
}

export function validateAdult(data: unknown): ValidationResult<AdultInput> {
  return validate(adultSchema, data);
}

export function validateSecondaries(data: unknown): ValidationResult<SecondariesInput> {
  return validate(secondariesArraySchema, data);
}

export function validateTheme(data: unknown): ValidationResult<ThemeInput> {
  return validate(themeSchema, data);
}
