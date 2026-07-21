/**
 * Tests for the validate.ts wrapper functions — they should flatten
 * Zod issues into a field-path → first-error map.
 */
import { describe, it, expect } from 'vitest';
import { validateChild, validateAdult, validateSecondaries, validateTheme } from '@/lib/validation/validate';
import { VALIDATION_COPY, bookTypeSchema } from '@/lib/validation/schemas';

describe('validateChild', () => {
  it('returns ok=true with typed data on valid input', () => {
    const result = validateChild({
      name: 'Iris',
      age_range: '5-7',
      gender: 'girl',
      appearance: 'x'.repeat(60),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('Iris');
    }
  });

  it('returns ok=false with field errors map on invalid input', () => {
    const result = validateChild({
      name: '',
      age_range: '10-12',
      gender: 'mystery',
      appearance: 'short',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['name']).toBe(VALIDATION_COPY.REQUIRED);
      expect(result.errors['age_range']).toBe(VALIDATION_COPY.CHOOSE_ONE);
      expect(result.errors['gender']).toBe(VALIDATION_COPY.CHOOSE_ONE);
      // appearance is now governed by a cross-field superRefine (structured-OR-
      // free-text), which Zod skips when sibling fields fail — so no appearance
      // error here. The appearance rule is covered in schemas/child-features tests.
    }
  });

  it('returns ok=false when given null/undefined', () => {
    expect(validateChild(null).ok).toBe(false);
    expect(validateChild(undefined).ok).toBe(false);
  });
});

describe('validateSecondaries', () => {
  it('accepts an empty array', () => {
    const result = validateSecondaries([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('keys per-card errors by array index', () => {
    const result = validateSecondaries([
      {
        name: 'Theo',
        subject_type: 'human',
        gender: 'boy',
        relationship: 'friend',
        appearance: 'x'.repeat(40),
        extra_care: false,
      },
      // Invalid second entry — missing required gender for human.
      {
        name: 'Mira',
        subject_type: 'human',
        relationship: 'cousin',
        appearance: 'x'.repeat(40),
        extra_care: false,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['1.gender']).toBe(VALIDATION_COPY.CHOOSE_ONE);
      expect(result.errors['0.name']).toBeUndefined();
    }
  });
});

describe('validateTheme', () => {
  it('accepts theme with optional template id', () => {
    const result = validateTheme({
      theme: 'A quiet afternoon at the park.',
      theme_template_id: 'milestone_first_school',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects too-short theme cleanly', () => {
    const result = validateTheme({ theme: 'Short.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['theme']).toBe(VALIDATION_COPY.TOO_SHORT);
    }
  });
});

// ---- Adult wizard (Slice 1) -------------------------------------------------
describe('validateAdult', () => {
  const ok = {
    name: 'Marcus',
    age: 40,
    gender: 'boy', // stored enum; the form shows "Man"
    appearance: 'a man with a short grey beard, tortoiseshell glasses, and a solid build',
  };

  it('accepts a complete adult subject', () => {
    expect(validateAdult(ok).ok).toBe(true);
  });
  it('coerces a numeric-string age from the form', () => {
    const r = validateAdult({ ...ok, age: '40' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.age).toBe(40);
  });
  it('rejects an age below 18 (adult-only product)', () => {
    expect(validateAdult({ ...ok, age: 12 }).ok).toBe(false);
  });
  it('rejects an age above 120', () => {
    expect(validateAdult({ ...ok, age: 130 }).ok).toBe(false);
  });
  it('requires gender (unlike a pet)', () => {
    expect(validateAdult({ ...ok, gender: '' }).ok).toBe(false);
  });
  it('requires a 30+ char appearance', () => {
    expect(validateAdult({ ...ok, appearance: 'short' }).ok).toBe(false);
  });
});

describe('validateTheme — vibe accepts pet AND adult registers', () => {
  it('accepts an adult vibe (roast)', () => {
    expect(validateTheme({ theme: 'A birthday roast of a man with a system.', vibe: 'roast' }).ok).toBe(true);
  });
  it('still accepts a pet vibe (memorial)', () => {
    expect(validateTheme({ theme: 'A gentle keepsake for a dog who has passed.', vibe: 'memorial' }).ok).toBe(true);
  });
  it('rejects an unknown vibe', () => {
    expect(validateTheme({ theme: 'A perfectly ordinary story about things.', vibe: 'nonsense' }).ok).toBe(false);
  });
});

describe('BOOK_TYPES includes adult (byte-identical: child + pet unchanged)', () => {
  it('accepts all three, defaults to child', () => {
    expect(bookTypeSchema.parse(undefined)).toBe('child');
    expect(bookTypeSchema.parse('child')).toBe('child');
    expect(bookTypeSchema.parse('pet')).toBe('pet');
    expect(bookTypeSchema.parse('adult')).toBe('adult');
  });
  it('rejects a typo', () => {
    expect(bookTypeSchema.safeParse('adlut').success).toBe(false);
  });
});
