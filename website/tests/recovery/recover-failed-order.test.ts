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

// ---- source:'health' — the proactive credit monitor's alert path ------------
// A synthetic monitor has no order and no preview. It routes through handleFailure
// so ops gets one alerting mechanism, not two (a second path would rot untested) —
// but it must NEVER reach the refund/customer branch.
describe('handleFailure — source: health', () => {
  const healthInput = (over: Record<string, unknown> = {}) => ({
    source: 'health' as const,
    check: 'gemini',
    transition: 'went_down',
    healthy: false,
    error: { message: 'Gemini image generation unavailable (credits_depleted)', kind: 'credits_depleted' },
    terminal: false,
    ...over,
  });

  it('alerts ops and NEVER refunds or emails a customer', async () => {
    const { deps, refundCreate } = makeDeps(makeOrder());
    const r = await handleFailure(healthInput(), deps);
    expect(r.source).toBe('health');
    expect(r.alerted).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.refundId).toBeNull();
    expect(refundCreate).not.toHaveBeenCalled();
    expect(deps.getOrderById).not.toHaveBeenCalled();
    expect(deps.updateOrderPipelineStatus).not.toHaveBeenCalled();
    expect(deps.sendEmail).toHaveBeenCalledOnce(); // the ops alert only
  });

  it('flags credit depletion so the alert carries the CREDITS DEPLETED banner', async () => {
    const { deps } = makeDeps(makeOrder());
    const r = await handleFailure(healthInput(), deps);
    expect(r.creditDepleted).toBe(true);
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.to).toBe('ops@tuatale.com');
    expect(mail.subject).toMatch(/CREDITS DEPLETED/);
  });

  // An empty-response outage is a different fix from a drained balance; saying
  // "top up" when the balance is fine sends the operator down the wrong path.
  it('a non-credit failure does NOT claim credits are depleted', async () => {
    const { deps } = makeDeps(makeOrder());
    const r = await handleFailure(
      healthInput({ error: { message: 'Gemini image generation unavailable (empty_response)', kind: 'empty_response' } }),
      deps,
    );
    expect(r.creditDepleted).toBe(false);
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.subject).not.toMatch(/CREDITS DEPLETED/);
    expect(mail.subject).toMatch(/monitor/i);
  });

  // A recovery notice must not arrive wearing the depletion banner.
  it('a recovery notice suppresses the depletion banner', async () => {
    const { deps } = makeDeps(makeOrder());
    await handleFailure(
      healthInput({
        transition: 'recovered', healthy: true,
        error: { message: 'Gemini image generation is responding again — credit alert cleared.', kind: 'ok' },
      }),
      deps,
    );
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.subject).not.toMatch(/CREDITS DEPLETED/);
  });

  it('identifies the check and transition in the alert body', async () => {
    const { deps } = makeDeps(makeOrder());
    await handleFailure(healthInput(), deps);
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.text).toMatch(/gemini \(went_down\)/);
  });
});

// ---- source: 'checkout' — charged-then-failed backstop (adult gate layer 4) --
// A payment succeeded but order creation was refused. ALWAYS refunds (terminal +
// unambiguous) AND alerts, idempotently, keyed on the payment_intent (no order id).
describe('handleFailure — source: checkout (charged, no order)', () => {
  const checkoutInput = (over: Record<string, unknown> = {}) => ({
    source: 'checkout' as const,
    stripeSessionId: 'cs_test_abc',
    paymentIntentId: 'pi_test_abc',
    error: { message: 'adult branch disabled at order creation', kind: 'adult_branch_disabled' },
    ...over,
  });

  it('REFUNDS (idempotent, keyed on payment_intent) and ALERTS', async () => {
    const { deps, refundCreate } = makeDeps(null);
    const r = await handleFailure(checkoutInput(), deps);
    expect(r).toMatchObject({ source: 'checkout', recovered: true, refundId: 're_123' });
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test_abc' },
      { idempotencyKey: 'tuatale-refund-checkout-pi_test_abc' },
    );
    expect(deps.sendEmail).toHaveBeenCalledOnce();
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.subject).toMatch(/CHARGED, NO ORDER/);
  });

  // A. Idempotency: the webhook retries. Two invocations on the same payment_intent
  // must pass the SAME idempotency key — the property that makes Stripe return the
  // same refund rather than a second. (True single-refund is Stripe-enforced; see the
  // stubbed-vs-real note in the report — a mock can only prove the key is stable.)
  it('IDEMPOTENT on retry: same payment_intent → identical idempotency key both times', async () => {
    const { deps, refundCreate } = makeDeps(null);
    await handleFailure(checkoutInput(), deps);
    await handleFailure(checkoutInput(), deps);
    const key1 = refundCreate.mock.calls[0]![1].idempotencyKey;
    const key2 = refundCreate.mock.calls[1]![1].idempotencyKey;
    expect(key1).toBe(key2);
    expect(key1).toBe('tuatale-refund-checkout-pi_test_abc');
  });

  it('resolves the payment_intent from the session when not passed', async () => {
    const { deps, refundCreate } = makeDeps(null);
    (deps.getStripe!() as unknown as { checkout: { sessions: { retrieve: ReturnType<typeof vi.fn> } } })
      .checkout.sessions.retrieve = vi.fn().mockResolvedValue({ payment_intent: 'pi_from_session' });
    await handleFailure(checkoutInput({ paymentIntentId: null }), deps);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_from_session' },
      { idempotencyKey: 'tuatale-refund-checkout-pi_from_session' },
    );
  });

  // B. Ordering: recovered reflects whether the refund SUCCEEDED. The caller (webhook)
  // acknowledges (2xx) ONLY when recovered=true; a failed refund → recovered=false →
  // the caller lets Stripe retry.
  it('recovered=false when the refund FAILS (caller must let Stripe retry)', async () => {
    const { deps, refundCreate } = makeDeps(null);
    refundCreate.mockRejectedValueOnce(new Error('stripe down'));
    const r = await handleFailure(checkoutInput(), deps);
    expect(r.recovered).toBe(false);
    expect(r.refundId).toBeNull();
    // Still alerts — ops must know a charge is un-refunded.
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail.subject).toMatch(/CHARGED, NO ORDER/);
    expect(mail.text).toMatch(/REFUND FAILED/);
  });
});

// ---- C. REGRESSION GUARD: adding a refunding source must NOT let health refund. ----
// Re-asserted in the SAME run as the new checkout-refund tests. 'order' refunds,
// 'checkout' refunds, 'health' NEVER refunds — the one way the monitor could do harm.
describe('refund behaviour is explicit per source (health never refunds)', () => {
  it('health: never refunds, never emails a customer', async () => {
    const { deps, refundCreate } = makeDeps(makeOrder());
    const r = await handleFailure(
      { source: 'health', check: 'gemini', transition: 'went_down', healthy: false, error: { message: 'x' } },
      deps,
    );
    expect(r.refundId).toBeNull();
    expect(r.recovered).toBe(false);
    expect(refundCreate).not.toHaveBeenCalled();
    // exactly one email — the ops alert, never a customer refund email
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });

  it('preview: never refunds', async () => {
    const { deps, refundCreate } = makeDeps(null);
    await handleFailure({ source: 'preview', previewId: 'p1', error: { message: 'x' } }, deps);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('checkout: DOES refund (contrast with health/preview)', async () => {
    const { deps, refundCreate } = makeDeps(null);
    await handleFailure({ source: 'checkout', paymentIntentId: 'pi_x', error: { message: 'x' } }, deps);
    expect(refundCreate).toHaveBeenCalledOnce();
  });
});
