import { describe, it, expect, afterEach } from 'vitest';
import { isAdultBranchEnabled } from '@/lib/flags';

describe('isAdultBranchEnabled — fail-closed', () => {
  const ORIGINAL = process.env.ADULT_BRANCH_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADULT_BRANCH_ENABLED;
    else process.env.ADULT_BRANCH_ENABLED = ORIGINAL;
  });

  it('unset → OFF', () => {
    delete process.env.ADULT_BRANCH_ENABLED;
    expect(isAdultBranchEnabled()).toBe(false);
  });
  it("exactly 'on' → ON", () => {
    process.env.ADULT_BRANCH_ENABLED = 'on';
    expect(isAdultBranchEnabled()).toBe(true);
  });
  it.each(['', 'true', 'ON', 'On', '1', 'yes', 'off'])('%j → OFF (only the exact string on enables)', (v) => {
    process.env.ADULT_BRANCH_ENABLED = v;
    expect(isAdultBranchEnabled()).toBe(false);
  });
});
