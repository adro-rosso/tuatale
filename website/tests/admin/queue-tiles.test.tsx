/**
 * QueueTiles tests. Verify each status gets a tile linked to the
 * filtered orders list + the awaiting-review tile carries the
 * iron-oxide priority styling.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueTiles } from '@/components/admin/QueueTiles';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';

const zeroCounts: Record<PipelineJobStatus, number> = {
  pending: 0,
  running: 0,
  awaiting_review: 0,
  shipped: 0,
  failed: 0,
  cancelled: 0,
};

describe('QueueTiles', () => {
  it('renders a tile per status with the given count', () => {
    const counts: Record<PipelineJobStatus, number> = {
      ...zeroCounts,
      awaiting_review: 5,
      pending: 3,
      shipped: 42,
    };
    const html = renderToStaticMarkup(<QueueTiles counts={counts} />);
    expect(html).toContain('Awaiting review');
    expect(html).toContain('>5<');
    expect(html).toContain('Pending');
    expect(html).toContain('>3<');
    expect(html).toContain('Shipped');
    expect(html).toContain('>42<');
  });

  it('links each tile to its filtered list view', () => {
    const html = renderToStaticMarkup(<QueueTiles counts={zeroCounts} />);
    expect(html).toContain('/admin/orders?status=pending');
    expect(html).toContain('/admin/orders?status=running');
    expect(html).toContain('/admin/orders?status=awaiting_review');
    expect(html).toContain('/admin/orders?status=shipped');
    expect(html).toContain('/admin/orders?status=failed');
    expect(html).toContain('/admin/orders?status=cancelled');
  });

  it('highlights the awaiting-review tile with iron-oxide background', () => {
    const html = renderToStaticMarkup(<QueueTiles counts={zeroCounts} />);
    // The awaiting-review anchor carries bg-iron-oxide; other tiles
    // start at bg-cream. Class attribute precedes href in the
    // rendered output — match the whole <a ...> opening tag.
    const reviewTag = html.match(
      /<a[^>]*href="\/admin\/orders\?status=awaiting_review"[^>]*>/,
    )?.[0];
    expect(reviewTag).toBeDefined();
    expect(reviewTag).toMatch(/bg-iron-oxide/);
    // And a non-priority tile (pending) should NOT carry bg-iron-oxide.
    const pendingTag = html.match(
      /<a[^>]*href="\/admin\/orders\?status=pending"[^>]*>/,
    )?.[0];
    expect(pendingTag).toBeDefined();
    expect(pendingTag).not.toMatch(/bg-iron-oxide/);
  });
});
