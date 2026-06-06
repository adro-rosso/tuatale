/**
 * formatRelativeTime + RelativeTime tests. Pins each unit threshold
 * + verifies the rendered <time> element carries the ISO dateTime
 * + title for hover tooltips.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatRelativeTime, RelativeTime } from '@/components/admin/RelativeTime';

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-06-06T12:00:00Z');

  it('formats sub-second diffs as "just now"', () => {
    expect(formatRelativeTime('2026-06-06T11:59:59.500Z', NOW)).toBe('just now');
  });

  it('formats minute-scale diffs', () => {
    expect(formatRelativeTime('2026-06-06T11:55:00Z', NOW)).toMatch(/minute/);
  });

  it('formats hour-scale diffs', () => {
    expect(formatRelativeTime('2026-06-06T09:00:00Z', NOW)).toBe('3 hours ago');
  });

  it('uses "yesterday" for ~1 day ago (Intl numeric:auto)', () => {
    expect(formatRelativeTime('2026-06-05T12:00:00Z', NOW)).toBe('yesterday');
  });

  it('formats multi-day diffs', () => {
    expect(formatRelativeTime('2026-06-01T12:00:00Z', NOW)).toBe('5 days ago');
  });

  it('formats week diffs', () => {
    expect(formatRelativeTime('2026-05-23T12:00:00Z', NOW)).toBe('2 weeks ago');
  });
});

describe('RelativeTime', () => {
  it('renders dash for null', () => {
    const html = renderToStaticMarkup(<RelativeTime iso={null} />);
    expect(html).toContain('—');
  });

  it('renders <time> with ISO dateTime + title attributes', () => {
    const iso = '2026-06-06T09:00:00Z';
    const html = renderToStaticMarkup(
      <RelativeTime iso={iso} now={new Date('2026-06-06T12:00:00Z')} />,
    );
    expect(html).toContain(`dateTime="${iso}"`);
    expect(html).toContain(`title="${iso}"`);
    expect(html).toContain('3 hours ago');
  });
});
