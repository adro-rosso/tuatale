/**
 * Format a timestamp as a relative-to-now string for admin dashboards.
 *
 * Examples: "3 hours ago", "yesterday", "5 days ago", "2 weeks ago".
 *
 * Uses Intl.RelativeTimeFormat (Node 18+ / modern browsers) so no
 * external date library. Renders as a <time> element with the full
 * ISO timestamp as the title attribute — hover reveals the exact
 * moment for admin reference.
 *
 * Returns plain text for tooling-friendliness when the input is null
 * (e.g. `started_at` on a still-pending job): "—".
 */
const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: 'day', ms: 1000 * 60 * 60 * 24 },
  { unit: 'hour', ms: 1000 * 60 * 60 },
  { unit: 'minute', ms: 1000 * 60 },
  { unit: 'second', ms: 1000 },
];

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diff = then - now.getTime();
  const absDiff = Math.abs(diff);
  // Pick the largest unit where |diff| >= 1; "just now" for sub-second.
  for (const { unit, ms } of UNITS) {
    if (absDiff >= ms) {
      const value = Math.round(diff / ms);
      return RTF.format(value, unit);
    }
  }
  return 'just now';
}

interface RelativeTimeProps {
  iso: string | null;
  /** Override the current time. Used by tests to make output deterministic. */
  now?: Date;
}

export function RelativeTime({ iso, now }: RelativeTimeProps) {
  if (!iso) return <span className="text-warm-grey">—</span>;
  const label = formatRelativeTime(iso, now);
  return (
    <time dateTime={iso} title={iso} className="tabular-nums">
      {label}
    </time>
  );
}
