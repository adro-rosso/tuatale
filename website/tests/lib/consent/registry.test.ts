/**
 * Consent registry — pins the APPROVED attestation wording (a legal rewording must bump the
 * version, which this test forces someone to acknowledge) and the canonical-text record.
 */
import { describe, it, expect } from 'vitest';
import { CONSENT, isConsentVersion, buildConsentRecord } from '@/lib/consent/registry';

describe('consent registry', () => {
  it('child-v1 is the approved parent/guardian attestation', () => {
    expect(CONSENT['child-v1'].label).toBe(
      "I am this child's parent or legal guardian, and I give permission for this photo to be used to illustrate their book.",
    );
    expect(CONSENT['child-v1'].hint).toMatch(/within 30 days of your book being sent/i);
  });

  it('companion-v1 spells out the terms in full (companions can be children)', () => {
    expect(CONSENT['companion-v1'].label).toBe(
      "I have the right to use these photos. For any child shown, I am their parent or legal guardian. We use them only to create your book's artwork — never anything else. You can remove them any time, and we delete them within 30 days of your book being sent.",
    );
  });

  it('isConsentVersion accepts only known versions', () => {
    expect(isConsentVersion('child-v1')).toBe(true);
    expect(isConsentVersion('companion-v1')).toBe(true);
    expect(isConsentVersion('child-v2')).toBe(false);
    expect(isConsentVersion('')).toBe(false);
  });

  it('buildConsentRecord stores version + CANONICAL text + timestamp', () => {
    const rec = buildConsentRecord('child-v1', '2026-08-28T00:00:00Z');
    expect(rec).toEqual({ version: 'child-v1', text: CONSENT['child-v1'].label, at: '2026-08-28T00:00:00Z' });
  });
});
