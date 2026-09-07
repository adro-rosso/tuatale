import { describe, it, expect } from 'vitest';
import { isValidEmail, normalizeEmail, maskEmail } from '@/lib/validation/email';

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('adrian.rosso+test@example.com')).toBe(true);
    expect(isValidEmail('  trimmed@example.com  ')).toBe(true);
  });
  it('rejects the obvious typos', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('two@@example.com')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false); // no dot-TLD
    expect(isValidEmail('spaces in@example.com')).toBe(false);
    expect(isValidEmail('trailing@example.c')).toBe(false); // 1-char TLD
    expect(isValidEmail(`${'a'.repeat(255)}@example.com`)).toBe(false); // over length cap
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Adrian@Example.COM ')).toBe('adrian@example.com');
  });
});

describe('maskEmail', () => {
  it('keeps the first local char + domain, hides the rest', () => {
    expect(maskEmail('adrian@example.com')).toBe('a•••@example.com');
    expect(maskEmail('  Bob@host.io ')).toBe('B•••@host.io');
  });
  it('never leaks a malformed value', () => {
    expect(maskEmail('@example.com')).toBe('•••');
    expect(maskEmail('nope')).toBe('•••');
  });
});
