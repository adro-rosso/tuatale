/**
 * Tests for /start/success page.
 *
 * The page is an async Server Component. We invoke it directly,
 * mock its DB dependency, and assert the React element tree it
 * returns (poking at props/children — enough to pin the four
 * states: confirmation, processing, took-too-long, missing-session).
 *
 * Renders aren't exercised through ReactDOM here — we just assert
 * the shape of the React element. That's enough to catch regressions
 * in the state machine without dragging jsdom into Server Component
 * semantics (which Next 16 itself doesn't fully expose for tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const { getOrderByStripeSessionIdSpy } = vi.hoisted(() => ({
  getOrderByStripeSessionIdSpy: vi.fn(),
}));

vi.mock('@/db/orders', () => ({
  getOrderByStripeSessionId: getOrderByStripeSessionIdSpy,
}));

import SuccessStepPage from '@/app/start/success/page';

async function renderPage(searchParams: {
  session_id?: string;
  attempt?: string;
}): Promise<string> {
  const element = (await SuccessStepPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

describe('SuccessStepPage', () => {
  beforeEach(() => {
    getOrderByStripeSessionIdSpy.mockReset();
  });

  it('renders confirmation when the order exists', async () => {
    getOrderByStripeSessionIdSpy.mockResolvedValue({
      id: 'order-uuid-1234-5678',
      child_name: 'Iris',
      customer_email: 'parent@example.com',
      theme: 'Iris discovers a tiny door at the back of the garden shed.',
      amount_paid_cents: 9400,
      currency: 'aud',
    });

    const html = await renderPage({ session_id: 'cs_test_abc' });
    expect(html).toContain('Iris');
    expect(html).toContain('book is being made');
    expect(html).toContain('parent@example.com');
    expect(html).toContain('order-uu'); // first 8 chars of the UUID
    expect(html).toContain('$94.00');
    expect(html).toContain('hello@tuatale.com');
    // No meta refresh in the confirmation state.
    expect(html).not.toMatch(/http-equiv="refresh"/);
  });

  it('renders processing state with meta refresh when order is missing', async () => {
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    const html = await renderPage({ session_id: 'cs_test_abc' });
    expect(html).toContain('Just a moment');
    expect(html).toContain('refresh on its own');
    expect(html).toMatch(/http-equiv="refresh"/);
    expect(html).toContain('attempt=1');
  });

  it('renders took-too-long state after 15 attempts with no order', async () => {
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    const html = await renderPage({ session_id: 'cs_test_abc', attempt: '15' });
    expect(html).toContain('taking longer than expected');
    expect(html).toContain('cs_test_abc');
    expect(html).toContain('hello@tuatale.com');
    expect(html).not.toMatch(/http-equiv="refresh"/);
  });

  it('renders missing-session state when session_id is absent', async () => {
    const html = await renderPage({});
    // renderToStaticMarkup HTML-encodes the apostrophe; match either form.
    expect(html).toMatch(/Something(?:&#x27;|')s missing/);
    expect(html).toContain('hello@tuatale.com');
    expect(getOrderByStripeSessionIdSpy).not.toHaveBeenCalled();
  });

  it('increments the attempt counter in the refresh URL', async () => {
    getOrderByStripeSessionIdSpy.mockResolvedValue(null);
    const html = await renderPage({ session_id: 'cs_test_abc', attempt: '3' });
    expect(html).toContain('attempt=4');
  });
});
