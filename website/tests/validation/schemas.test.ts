/**
 * Zod schema tests — verify each schema accepts valid input and rejects
 * each invalid case with the exact brand-voice error string. Tests
 * assert against VALIDATION_COPY rather than retyping the strings so a
 * copy change in one place breaks tests in one place.
 */
import { describe, it, expect } from 'vitest';
import {
  childSchema,
  secondarySchema,
  secondariesArraySchema,
  themeSchema,
  VALIDATION_COPY,
} from '@/lib/validation/schemas';

const validChild = {
  name: 'Iris',
  age_range: '5-7' as const,
  gender: 'girl' as const,
  appearance:
    'wavy auburn hair to her shoulders, fair skin with a sprinkle of freckles, hazel eyes, yellow rain boots, denim overalls',
};

const validHumanSecondary = {
  name: 'Theo',
  subject_type: 'human' as const,
  gender: 'boy' as const,
  relationship: 'friend',
  appearance:
    'long straight black hair to the jawline, warm brown eyes, navy-and-white striped tee with brown overalls',
  extra_care: false,
};

const validPetSecondary = {
  name: 'Pepper',
  subject_type: 'non_human' as const,
  relationship: 'pet',
  appearance:
    'small scruffy grey-and-white mixed-breed dog, one floppy ear, one upright, red collar',
  extra_care: true,
};

describe('childSchema', () => {
  it('accepts a valid child input', () => {
    expect(childSchema.safeParse(validChild).success).toBe(true);
  });

  it('rejects empty name with "We\'ll need this."', () => {
    const result = childSchema.safeParse({ ...validChild, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find((i) => i.path[0] === 'name')?.message).toBe(
        VALIDATION_COPY.REQUIRED,
      );
    }
  });

  it('rejects 51-char name with too-long copy', () => {
    const result = childSchema.safeParse({
      ...validChild,
      name: 'x'.repeat(51),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.TOO_LONG);
    }
  });

  it('rejects invalid age_range', () => {
    const result = childSchema.safeParse({
      ...validChild,
      age_range: '10-12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.CHOOSE_ONE);
    }
  });

  it('rejects invalid gender', () => {
    const result = childSchema.safeParse({
      ...validChild,
      gender: 'mystery',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.CHOOSE_ONE);
    }
  });

  it('rejects 49-char appearance as too short', () => {
    const result = childSchema.safeParse({
      ...validChild,
      appearance: 'x'.repeat(49),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.TOO_SHORT);
    }
  });

  it('rejects 501-char appearance as at upper limit', () => {
    const result = childSchema.safeParse({
      ...validChild,
      appearance: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.AT_UPPER);
    }
  });

  it('accepts exactly-at-boundary lengths', () => {
    expect(childSchema.safeParse({ ...validChild, name: 'x'.repeat(50) }).success).toBe(true);
    expect(childSchema.safeParse({ ...validChild, appearance: 'x'.repeat(50) }).success).toBe(true);
    expect(childSchema.safeParse({ ...validChild, appearance: 'x'.repeat(500) }).success).toBe(
      true,
    );
  });
});

describe('secondarySchema', () => {
  it('accepts a valid human secondary', () => {
    expect(secondarySchema.safeParse(validHumanSecondary).success).toBe(true);
  });

  it('accepts a valid pet secondary (no gender required)', () => {
    expect(secondarySchema.safeParse(validPetSecondary).success).toBe(true);
  });

  it('rejects human secondary missing gender', () => {
    const result = secondarySchema.safeParse({
      ...validHumanSecondary,
      gender: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const genderIssue = result.error.issues.find((i) => i.path[0] === 'gender');
      expect(genderIssue?.message).toBe(VALIDATION_COPY.CHOOSE_ONE);
    }
  });

  it('rejects empty relationship with the bespoke copy', () => {
    const result = secondarySchema.safeParse({
      ...validHumanSecondary,
      relationship: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.RELATIONSHIP_REQUIRED);
    }
  });

  it('accepts non-human secondary with extra_care toggled', () => {
    expect(secondarySchema.safeParse({ ...validPetSecondary, extra_care: true }).success).toBe(
      true,
    );
  });

  it('defaults extra_care to false', () => {
    const result = secondarySchema.safeParse({
      name: 'Bramble',
      subject_type: 'non_human',
      relationship: 'pet',
      appearance: 'a small terrier with shaggy tan coat and a black ear tip',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extra_care).toBe(false);
    }
  });
});

describe('secondariesArraySchema', () => {
  it('accepts empty array', () => {
    expect(secondariesArraySchema.safeParse([]).success).toBe(true);
  });

  it('accepts exactly 3 secondaries', () => {
    expect(
      secondariesArraySchema.safeParse([
        validHumanSecondary,
        validHumanSecondary,
        validPetSecondary,
      ]).success,
    ).toBe(true);
  });

  it('rejects 4 secondaries with "up to three" message', () => {
    const result = secondariesArraySchema.safeParse([
      validHumanSecondary,
      validHumanSecondary,
      validHumanSecondary,
      validPetSecondary,
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('three');
    }
  });
});

describe('themeSchema', () => {
  it('accepts a 20-char-min theme', () => {
    expect(themeSchema.safeParse({ theme: 'A quiet afternoon at the park.' }).success).toBe(true);
  });

  it('rejects too-short theme', () => {
    const result = themeSchema.safeParse({ theme: 'Short.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.TOO_SHORT);
    }
  });

  it('rejects too-long theme', () => {
    const result = themeSchema.safeParse({ theme: 'x'.repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(VALIDATION_COPY.AT_UPPER);
    }
  });

  it('accepts optional theme_template_id', () => {
    expect(
      themeSchema.safeParse({
        theme: 'A quiet afternoon at the park.',
        theme_template_id: 'milestone_first_school',
      }).success,
    ).toBe(true);
  });
});
