import { describe, it, expect } from 'vitest';
import {
  buildEmailChangeConfirmation,
  buildEmailChangeAlert,
} from '@/lib/email/templates/email-change';

describe('buildEmailChangeConfirmation', () => {
  it('addresses the NEW email and names the order', () => {
    const c = buildEmailChangeConfirmation({ newEmail: 'new@example.com', childName: 'Mia', orderId: 'abc1234567' });
    expect(c.to).toBe('new@example.com');
    expect(c.subject).toMatch(/order emails now come here/i);
    expect(c.text).toContain('abc12345'); // short order id
    expect(c.html).toContain('Mia');
  });
  it('escapes HTML in the child name', () => {
    const c = buildEmailChangeConfirmation({ newEmail: 'a@b.co', childName: '<script>', orderId: 'x' });
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;');
  });
});

describe('buildEmailChangeAlert', () => {
  it('addresses the OLD email and shows only the masked new address', () => {
    const a = buildEmailChangeAlert({
      oldEmail: 'old@example.com',
      newEmailMasked: 'n•••@example.com',
      childName: 'Mia',
      orderId: 'abc',
    });
    expect(a.to).toBe('old@example.com');
    expect(a.subject).toMatch(/was changed/i);
    expect(a.text).toContain('n•••@example.com');
    // the full new local-part must never appear
    expect(a.text).not.toContain('newfull@example.com');
  });
});
