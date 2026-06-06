/**
 * ActionPanel tests. Status-by-status assert the right buttons
 * appear + the notes textarea is wired with defaultValue.
 *
 * The Server Actions themselves are tested separately; here we
 * just verify the visual contract (which buttons show, which
 * formAction prop points where).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionPanel } from '@/components/admin/ActionPanel';
import type { Tables } from '@/types/database';

type PipelineJobRow = Tables<'pipeline_jobs'>;

function fakeJob(over: Partial<PipelineJobRow> = {}): PipelineJobRow {
  return {
    id: 'job-uuid-1',
    order_id: 'order-uuid-1',
    status: 'awaiting_review',
    created_at: '2026-06-06T09:00:00Z',
    updated_at: '2026-06-06T09:00:00Z',
    started_at: '2026-06-06T09:00:05Z',
    completed_at: '2026-06-06T09:00:25Z',
    shipped_at: null,
    failed_at: null,
    attempt_count: 0,
    inngest_event_id: 'evt_abc',
    inngest_run_id: 'run_xyz',
    pdf_url: 'https://placeholder.tuatale.com/stub-book.pdf',
    generation_metadata: null,
    error_message: null,
    error_details: null,
    reviewed_by: null,
    review_notes: 'half-written notes',
    ...over,
  };
}

const noop = async () => {};
const actions = {
  saveNotesAction: noop,
  shipAction: noop,
  retryAction: noop,
  cancelAction: noop,
};

describe('ActionPanel', () => {
  it('awaiting_review: shows Save + Ship + Cancel; no Retry', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'awaiting_review' })} {...actions} />,
    );
    expect(html).toContain('Save notes');
    expect(html).toContain('Ship to customer');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Retry');
    // Notes textarea has the job's current review_notes prefilled.
    expect(html).toContain('half-written notes');
  });

  it('failed: shows Save + Retry + Cancel; no Ship', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'failed' })} {...actions} />,
    );
    expect(html).toContain('Save notes');
    expect(html).toContain('Retry');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Ship to customer');
  });

  it('pending: shows Save + Cancel; explanatory text', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'pending' })} {...actions} />,
    );
    expect(html).toContain('Save notes');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Ship to customer');
    expect(html).not.toContain('Retry');
    expect(html).toMatch(/picked this job up yet/);
  });

  it('running: explains why no actions are available (admin must wait)', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'running' })} {...actions} />,
    );
    expect(html).toMatch(/Pipeline is running/);
    expect(html).not.toContain('Ship to customer');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Cancel');
  });

  it('shipped: terminal — no actions, only the terminal-state note', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'shipped' })} {...actions} />,
    );
    expect(html).toMatch(/terminal state/);
    expect(html).not.toContain('Ship to customer');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Save notes');
  });

  it('cancelled: terminal — same as shipped', () => {
    const html = renderToStaticMarkup(
      <ActionPanel job={fakeJob({ status: 'cancelled' })} {...actions} />,
    );
    expect(html).toMatch(/terminal state/);
    expect(html).not.toContain('Save notes');
  });
});
