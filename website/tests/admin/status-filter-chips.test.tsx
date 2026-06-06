import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusFilterChips } from '@/components/admin/StatusFilterChips';

describe('StatusFilterChips', () => {
  it('renders a chip for each status with its filtered link', () => {
    const html = renderToStaticMarkup(<StatusFilterChips active="awaiting_review" />);
    expect(html).toContain('/admin/orders?status=awaiting_review');
    expect(html).toContain('/admin/orders?status=pending');
    expect(html).toContain('/admin/orders?status=running');
    expect(html).toContain('/admin/orders?status=failed');
    expect(html).toContain('/admin/orders?status=shipped');
    expect(html).toContain('/admin/orders?status=cancelled');
  });

  it('highlights the active chip with iron-oxide styling + aria-current', () => {
    const html = renderToStaticMarkup(<StatusFilterChips active="failed" />);
    const failedTag = html.match(/<a[^>]*href="\/admin\/orders\?status=failed"[^>]*>/)?.[0];
    expect(failedTag).toBeDefined();
    expect(failedTag).toMatch(/bg-iron-oxide/);
    expect(failedTag).toMatch(/aria-current="page"/);
    // Non-active chip is bg-cream, no aria-current.
    const pendingTag = html.match(/<a[^>]*href="\/admin\/orders\?status=pending"[^>]*>/)?.[0];
    expect(pendingTag).not.toMatch(/bg-iron-oxide/);
    expect(pendingTag).not.toMatch(/aria-current/);
  });
});
