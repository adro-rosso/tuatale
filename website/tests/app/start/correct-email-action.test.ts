/**
 * correctOrderEmail — flag gate, format, ownership, unshipped gate, rate limit, and the
 * optimistic update + best-effort notifications. DB, pipeline-jobs, and email send are mocked;
 * the email templates + validation run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/orders')>();
  return { ...actual, getOrderByStripeSessionId: vi.fn(), applyEmailCorrection: vi.fn() };
});
vi.mock('@/db/pipeline-jobs', () => ({ getJobByOrderId: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));

import { correctOrderEmail } from '@/app/start/success/_actions/correct-email';
import { getOrderByStripeSessionId, applyEmailCorrection } from '@/db/orders';
import { getJobByOrderId } from '@/db/pipeline-jobs';
import { sendEmail } from '@/lib/email/send';

const getOrder = getOrderByStripeSessionId as ReturnType<typeof vi.fn>;
const getJob = getJobByOrderId as ReturnType<typeof vi.fn>;
const apply = applyEmailCorrection as ReturnType<typeof vi.fn>;
const send = sendEmail as ReturnType<typeof vi.fn>;

const IDLE = { status: 'idle' as const };
function fd(email: string): FormData {
  const f = new FormData();
  f.set('email', email);
  return f;
}
function order(over: Record<string, unknown> = {}) {
  return { id: 'o1', customer_email: 'old@example.com', child_name: 'Mia', email_change_log: [], ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_CORRECTION_ENABLED = 'on';
  getOrder.mockResolvedValue(order());
  getJob.mockResolvedValue(null); // unshipped
  apply.mockResolvedValue(undefined);
  send.mockResolvedValue({ success: true, messageId: 'm1' });
});

describe('gates', () => {
  it('flag off → error, no order lookup, no write', async () => {
    delete process.env.EMAIL_CORRECTION_ENABLED;
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
    expect(getOrder).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('empty + malformed addresses are rejected before any write', async () => {
    expect((await correctOrderEmail('sess', IDLE, fd('   '))).status).toBe('error');
    expect((await correctOrderEmail('sess', IDLE, fd('not-an-email'))).status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });

  it('unknown order (bad/absent session token) → error', async () => {
    getOrder.mockResolvedValue(null);
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });

  it('same email as current → friendly no-op error', async () => {
    const s = await correctOrderEmail('sess', IDLE, fd('OLD@example.com')); // case-insensitive
    expect(s.status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });

  it('already shipped → refused (notification already went out)', async () => {
    getJob.mockResolvedValue({ status: 'shipped' });
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('rate limit', () => {
  it('refuses after MAX_CHANGES (3) prior changes', async () => {
    const old = '2000-01-01T00:00:00.000Z';
    getOrder.mockResolvedValue(
      order({ email_change_log: [1, 2, 3].map(() => ({ from: 'a', to: 'b', at: old, source: 's' })) }),
    );
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });

  it('refuses inside the cooldown window (last change just now)', async () => {
    getOrder.mockResolvedValue(
      order({ email_change_log: [{ from: 'a', to: 'b', at: new Date().toISOString(), source: 's' }] }),
    );
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('updates the email, appends the audit entry, sends both notifications', async () => {
    const s = await correctOrderEmail('sess', IDLE, fd('  New@Example.com '));

    expect(s).toEqual({ status: 'success', email: 'new@example.com' });

    // applyEmailCorrection(id, normalizedNewEmail, [...existing, entry])
    expect(apply).toHaveBeenCalledTimes(1);
    const [id, email, log] = apply.mock.calls[0]!;
    expect(id).toBe('o1');
    expect(email).toBe('new@example.com');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ from: 'old@example.com', to: 'new@example.com', source: 'self_serve_success' });

    // confirmation to NEW + alert to OLD
    expect(send).toHaveBeenCalledTimes(2);
    const recipients = send.mock.calls.map((c) => c[0].to);
    expect(recipients).toContain('new@example.com');
    expect(recipients).toContain('old@example.com');
  });

  it('still succeeds if a notification send fails (best-effort)', async () => {
    send.mockRejectedValue(new Error('resend down'));
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('success');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('returns an error (no throw) when the DB write fails', async () => {
    apply.mockRejectedValue(new Error('db down'));
    const s = await correctOrderEmail('sess', IDLE, fd('new@example.com'));
    expect(s.status).toBe('error');
  });
});
