/**
 * R2 — recovery fan-out. Pure unit tests with injected deps (no DB/Stripe/Resend/$).
 * Paid order → refund + customer email + status sync (once each) + ops-alert;
 * preview → ops-alert only; idempotent (already-recovered → no double refund/email);
 * RESOURCE_EXHAUSTED → distinct credits-depleted ops alert.
 */
import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { handleFailure } from '@/lib/recovery/recover-failed-order';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-123',
    customer_email: 'parent@example.com',
    child_name: 'Leo',
    stripe_payment_intent_id: 'pi_abc',
    stripe_session_id: 'cs_abc',
    pipeline_error: null,
    ...overrides,
  };
}

function makeDeps(order: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
  const refundCreate = vi.fn().mockResolvedValue({ id: 're_123' });
  // Minimal Stripe mock — only the surface handleFailure uses (refunds.create +
  // checkout.sessions.retrieve). Cast to Stripe for the dep's type.
  const stripeMock = { refunds: { create: refundCreate }, checkout: { sessions: { retrieve: vi.fn() } } } as unknown as Stripe;
  return {
    deps: {
      getOrderById: vi.fn().mockResolvedValue(order),
      updateOrderPipelineStatus: vi.fn().mockResolvedValue({}),
      getStripe: () => stripeMock,
      sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'm_1' }),
      adminEmail: 'ops@tuatale.com',
      now: () => '2026-06-17T00:00:00.000Z',
      ...overrides,
    },
    refundCreate,
  };
}

describe('handleFailure — paid order recovery (A + B)', () => {
  it('refunds, emails the customer, syncs status — each once — and writes the recovery marker', async () => {
    const order = makeOrder();
    const { deps, refundCreate } = makeDeps(order);

    const r = await handleFailure(
      { source: 'order', orderId: 'order-123', jobId: 'job-1', terminal: true, error: { message: 'render exploded' } },
      deps,
    );

    expect(r).toMatchObject({ source: 'order', recovered: true, refundId: 're_123', creditDepleted: false });

    // Refund once, with the deterministic idempotency key (double-fire safe at Stripe).
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_abc' },
      { idempotencyKey: 'tuatale-refund-order-123' },
    );

    // Two emails: ops-alert + customer.
    const sendEmail = deps.sendEmail as ReturnType<typeof vi.fn>;
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const tos = sendEmail.mock.calls.map((c) => c[0].to);
    expect(tos).toContain('ops@tuatale.com');
    expect(tos).toContain('parent@example.com');

    // Status synced once, with the recovery marker in pipeline_error.
    const update = deps.updateOrderPipelineStatus as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0]!;
    expect(id).toBe('order-123');
    expect(patch.pipeline_status).toBe('failed');
    expect(patch.pipeline_error.recovery).toMatchObject({ refund_id: 're_123', refunded: true, notified: true });
  });

  it('IDEMPOTENT: already-recovered order → no refund, no email, no status write', async () => {
    const order = makeOrder({ pipeline_error: { recovery: { recovered_at: 'x', refund_id: 're_prev' } } });
    const { deps, refundCreate } = makeDeps(order);

    const r = await handleFailure({ source: 'order', orderId: 'order-123', terminal: true, error: { message: 'x' } }, deps);

    expect(r.skipped).toBe('already-recovered');
    expect(r.recovered).toBe(false);
    expect(refundCreate).not.toHaveBeenCalled();
    // R3c: ops-alert always fires (1 call, before the idempotency check); the
    // customer email + status write are what's guarded.
    const sendEmail = deps.sendEmail as ReturnType<typeof vi.fn>;
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].to).toBe('ops@tuatale.com');
    expect(deps.updateOrderPipelineStatus).not.toHaveBeenCalled();
  });

  it('R3c: NON-TERMINAL order (resumable) → ops-alert ONLY, no refund/customer-email/status', async () => {
    const { deps, refundCreate } = makeDeps(makeOrder());
    const r = await handleFailure(
      { source: 'order', orderId: 'order-123', terminal: false, error: { message: '503 transient' } },
      deps,
    );
    expect(r).toMatchObject({ source: 'order', recovered: false, refundId: null, deferred: 'non-terminal' });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(deps.updateOrderPipelineStatus).not.toHaveBeenCalled();
    expect(deps.getOrderById).not.toHaveBeenCalled(); // defers before the order fetch
    const sendEmail = deps.sendEmail as ReturnType<typeof vi.fn>;
    expect(sendEmail).toHaveBeenCalledTimes(1); // ops-alert only
    expect(sendEmail.mock.calls[0]![0].to).toBe('ops@tuatale.com');
  });

  it('R3c: credit-park (terminal:false, RESOURCE_EXHAUSTED) → credits-depleted ops alert, NO refund', async () => {
    const { deps, refundCreate } = makeDeps(makeOrder());
    const r = await handleFailure(
      { source: 'order', orderId: 'order-123', terminal: false, error: { message: 'Gemini RESOURCE_EXHAUSTED: quota' } },
      deps,
    );
    expect(r.creditDepleted).toBe(true);
    expect(r.deferred).toBe('non-terminal');
    expect(refundCreate).not.toHaveBeenCalled();
    const sendEmail = deps.sendEmail as ReturnType<typeof vi.fn>;
    const opsCall = sendEmail.mock.calls.find((c) => c[0].to === 'ops@tuatale.com');
    expect(opsCall![0].subject).toMatch(/CREDITS DEPLETED/);
  });
});

describe('handleFailure — preview (B only, no charge)', () => {
  it('sends the ops-alert only — no order lookup, refund, customer email, or status write', async () => {
    const { deps, refundCreate } = makeDeps(null);
    const r = await handleFailure({ source: 'preview', previewId: 'prev-9', error: { message: 'preview boom' } }, deps);

    expect(r).toMatchObject({ source: 'preview', recovered: false, refundId: null });
    expect(deps.getOrderById).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
    expect(deps.updateOrderPipelineStatus).not.toHaveBeenCalled();

    const sendEmail = deps.sendEmail as ReturnType<typeof vi.fn>;
    expect(sendEmail).toHaveBeenCalledTimes(1); // ops only
    expect(sendEmail.mock.calls[0]![0].to).toBe('ops@tuatale.com');
  });
});
