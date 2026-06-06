import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderList } from '@/components/admin/OrderList';
import type { Tables } from '@/types/database';

type PipelineJobRow = Tables<'pipeline_jobs'>;
type OrderRow = Tables<'orders'>;

function fakeJob(over: Partial<PipelineJobRow> = {}): PipelineJobRow {
  return {
    id: 'job-uuid-1',
    order_id: 'order-uuid-1234-5678',
    status: 'awaiting_review',
    created_at: '2026-06-06T09:00:00Z',
    updated_at: '2026-06-06T09:00:00Z',
    started_at: null,
    completed_at: null,
    shipped_at: null,
    failed_at: null,
    attempt_count: 0,
    inngest_event_id: null,
    inngest_run_id: null,
    pdf_url: null,
    generation_metadata: null,
    error_message: null,
    error_details: null,
    reviewed_by: null,
    review_notes: null,
    notification_sent_at: null,
    notification_message_id: null,
    notification_error: null,
    ...over,
  };
}

function fakeOrder(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-uuid-1234-5678',
    child_name: 'Iris',
    customer_email: 'parent@example.com',
    theme: 'Iris discovers a tiny door at the back of the garden shed.',
    age_range: '5-7',
    child_age: 6,
    child_appearance: 'curly brown hair',
    child_gender: 'girl',
    amount_paid_cents: 7900,
    currency: 'aud',
    stripe_session_id: 'cs_test_x',
    stripe_payment_intent_id: 'pi_test_x',
    paid_at: '2026-06-06T08:55:00Z',
    secondaries: [],
    theme_template_id: null,
    photo_urls: [],
    photo_consent_at: null,
    character_generation_mode: 'text_only',
    pipeline_status: 'queued',
    pipeline_started_at: null,
    pipeline_completed_at: null,
    pipeline_error: null,
    story_dir: null,
    book_pdf_url: null,
    converted_from_draft_id: 'draft-uuid-x',
    created_at: '2026-06-06T08:55:00Z',
    updated_at: '2026-06-06T08:55:00Z',
    ...over,
  };
}

describe('OrderList', () => {
  it('renders empty state when no rows match the filter', () => {
    const html = renderToStaticMarkup(<OrderList rows={[]} filterStatus="awaiting_review" />);
    expect(html).toContain('No orders awaiting review.');
  });

  it('renders a row per job with order summary fields + Review link', () => {
    const html = renderToStaticMarkup(
      <OrderList rows={[{ job: fakeJob(), order: fakeOrder() }]} filterStatus="awaiting_review" />,
    );
    // Short order id (first 8 chars).
    expect(html).toContain('order-uu');
    // Customer-facing fields.
    expect(html).toContain('Iris');
    expect(html).toContain('parent@example.com');
    // Theme excerpt — 60-char truncation. The theme here is 59 chars so
    // it lands without ellipsis; the assertion just confirms it's there.
    expect(html).toMatch(/Iris discovers a tiny door/);
    // Review action.
    expect(html).toContain('/admin/orders/job-uuid-1');
    expect(html).toContain('Review');
  });

  it('renders dashes when the order is missing (defensive)', () => {
    const html = renderToStaticMarkup(
      <OrderList rows={[{ job: fakeJob(), order: null }]} filterStatus="awaiting_review" />,
    );
    // Order id, customer name, theme all dash.
    expect(html).toContain('—');
    // Status badge still shows so admin can see something's there.
    expect(html).toContain('Awaiting review');
  });

  it('truncates a long theme to 60 chars + ellipsis', () => {
    const longTheme = 'A'.repeat(200);
    const html = renderToStaticMarkup(
      <OrderList
        rows={[{ job: fakeJob(), order: fakeOrder({ theme: longTheme }) }]}
        filterStatus="awaiting_review"
      />,
    );
    // 60 As followed by an ellipsis.
    expect(html).toMatch(/A{60}…/);
  });
});
