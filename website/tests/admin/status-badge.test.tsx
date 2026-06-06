/**
 * StatusBadge + statusLabel tests. Pin every status-to-label mapping
 * + assert the priority status carries iron-oxide background classes
 * so future style refactors can't silently de-prioritise the queue's
 * most important state.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge, statusLabel } from '@/components/admin/StatusBadge';
import { PIPELINE_JOB_STATUSES } from '@/db/pipeline-jobs';

describe('statusLabel', () => {
  it('returns a human label for every pipeline status', () => {
    const expected: Record<string, string> = {
      pending: 'Pending',
      running: 'Running',
      awaiting_review: 'Awaiting review',
      shipped: 'Shipped',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };
    for (const status of PIPELINE_JOB_STATUSES) {
      expect(statusLabel(status)).toBe(expected[status]);
    }
  });
});

describe('StatusBadge', () => {
  it('renders the label for the given status', () => {
    expect(renderToStaticMarkup(<StatusBadge status="pending" />)).toContain('Pending');
    expect(renderToStaticMarkup(<StatusBadge status="awaiting_review" />)).toContain(
      'Awaiting review',
    );
    expect(renderToStaticMarkup(<StatusBadge status="shipped" />)).toContain('Shipped');
  });

  it('uses the iron-oxide priority style for awaiting_review', () => {
    const html = renderToStaticMarkup(<StatusBadge status="awaiting_review" />);
    expect(html).toMatch(/bg-iron-oxide/);
    expect(html).toMatch(/text-cream/);
  });

  it('uses warm-grey for cancelled (terminal, low-attention)', () => {
    const html = renderToStaticMarkup(<StatusBadge status="cancelled" />);
    expect(html).toMatch(/bg-warm-grey/);
  });

  it('uses red for failed (alarm)', () => {
    const html = renderToStaticMarkup(<StatusBadge status="failed" />);
    expect(html).toMatch(/red/);
  });
});
