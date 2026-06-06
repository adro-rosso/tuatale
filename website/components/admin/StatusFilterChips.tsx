import Link from 'next/link';
import { PIPELINE_JOB_STATUSES, type PipelineJobStatus } from '@/db/pipeline-jobs';
import { statusLabel } from './StatusBadge';

/**
 * Row of clickable status filter chips at the top of the orders
 * list. Active chip is highlighted iron-oxide; the rest are
 * outlined.
 *
 * Order is queue-priority: awaiting_review first (the work item),
 * then forward states (pending, running), then terminal states.
 */
const CHIP_ORDER: ReadonlyArray<PipelineJobStatus> = [
  'awaiting_review',
  'pending',
  'running',
  'failed',
  'shipped',
  'cancelled',
];

interface StatusFilterChipsProps {
  active: PipelineJobStatus;
}

export function StatusFilterChips({ active }: StatusFilterChipsProps) {
  // Defence-in-depth: if a future commit adds a new status to
  // PIPELINE_JOB_STATUSES but forgets to add it to CHIP_ORDER, the
  // existing chips still render — and the missing status is visible
  // because its slot is empty in the list. Better than silently
  // dropping the new status.
  return (
    <nav aria-label="Filter by status" className="gap-sm flex flex-wrap">
      {CHIP_ORDER.filter((s) => (PIPELINE_JOB_STATUSES as readonly string[]).includes(s)).map(
        (status) => {
          const isActive = status === active;
          const classes = isActive
            ? 'bg-iron-oxide text-cream border-iron-oxide'
            : 'bg-cream text-near-black border-warm-grey-light hover:border-iron-oxide';
          return (
            <Link
              key={status}
              href={`/admin/orders?status=${status}`}
              className={`font-body text-caption inline-flex items-center rounded-full border px-md py-xs font-medium transition-colors ${classes}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {statusLabel(status)}
            </Link>
          );
        },
      )}
    </nav>
  );
}
