/**
 * EmailStatusIndicator + hasEmailActivity tests. Pin each of the
 * three render states so a future schema or copy change doesn't
 * silently break the admin's "did the customer get their email"
 * signal.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailStatusIndicator, hasEmailActivity } from '@/components/admin/EmailStatusIndicator';
import type { Tables } from '@/types/database';

type PipelineJobRow = Tables<'pipeline_jobs'>;

function fakeJob(over: Partial<PipelineJobRow> = {}): PipelineJobRow {
  return {
    id: 'job-1',
    order_id: 'order-1',
    status: 'shipped',
    created_at: '2026-06-08T09:00:00Z',
    updated_at: '2026-06-08T09:00:00Z',
    started_at: '2026-06-08T09:00:05Z',
    completed_at: '2026-06-08T09:00:25Z',
    shipped_at: '2026-06-08T10:00:00Z',
    failed_at: null,
    attempt_count: 0,
    inngest_event_id: null,
    inngest_run_id: null,
    pdf_url: 'https://r2.tuatale.com/orders/abc/book.pdf',
    generation_metadata: null,
    checkpoint: null,
    next_retry_at: null,
    error_message: null,
    error_details: null,
    reviewed_by: 'adro',
    review_notes: null,
    notification_sent_at: null,
    notification_message_id: null,
    notification_error: null,
    ...over,
  };
}

describe('hasEmailActivity', () => {
  it('false when neither sent_at nor error is set', () => {
    expect(hasEmailActivity(fakeJob())).toBe(false);
  });
  it('true when sent_at is set', () => {
    expect(hasEmailActivity(fakeJob({ notification_sent_at: '2026-06-08T10:01:00Z' }))).toBe(true);
  });
  it('true when error is set (failure or stub-skip)', () => {
    expect(hasEmailActivity(fakeJob({ notification_error: 'whatever' }))).toBe(true);
  });
});

describe('EmailStatusIndicator', () => {
  it('renders the sent state with relative time + Resend message id', () => {
    const html = renderToStaticMarkup(
      <EmailStatusIndicator
        job={fakeJob({
          notification_sent_at: '2026-06-08T10:00:00Z',
          notification_message_id: 'msg_abc123',
        })}
      />,
    );
    expect(html).toContain('Email sent');
    expect(html).toContain('msg_abc123');
    expect(html).toContain('Resend message id');
    // Green dot color encoded inline.
    expect(html).toContain('1f7a4d');
  });

  it('renders the sent state even without a message id (defensive)', () => {
    const html = renderToStaticMarkup(
      <EmailStatusIndicator
        job={fakeJob({
          notification_sent_at: '2026-06-08T10:00:00Z',
          notification_message_id: null,
        })}
      />,
    );
    expect(html).toContain('Email sent');
    expect(html).not.toContain('Resend message id');
  });

  it('renders the failure state with the error string + red dot', () => {
    const html = renderToStaticMarkup(
      <EmailStatusIndicator
        job={fakeJob({
          notification_error: 'Resend rejected: invalid recipient',
        })}
      />,
    );
    expect(html).toContain('Email not sent');
    expect(html).toContain('Resend rejected: invalid recipient');
    expect(html).toContain('b3261e');
  });

  it('renders the stub-skip case with its sentinel message', () => {
    const html = renderToStaticMarkup(
      <EmailStatusIndicator
        job={fakeJob({
          notification_error: 'stub PDF — email skipped (pre-Track-B pipeline integration)',
        })}
      />,
    );
    expect(html).toContain('Email not sent');
    expect(html).toMatch(/stub PDF/);
  });

  it('returns null when neither field is set', () => {
    const html = renderToStaticMarkup(<EmailStatusIndicator job={fakeJob()} />);
    expect(html).toBe('');
  });

  it('prefers the sent path over error when both are set (e.g. retried success after prior failure)', () => {
    const html = renderToStaticMarkup(
      <EmailStatusIndicator
        job={fakeJob({
          notification_sent_at: '2026-06-08T11:00:00Z',
          notification_message_id: 'msg_v2',
          notification_error: 'old failure that retried successfully',
        })}
      />,
    );
    expect(html).toContain('Email sent');
    expect(html).not.toContain('Email not sent');
    expect(html).not.toContain('old failure');
  });
});
