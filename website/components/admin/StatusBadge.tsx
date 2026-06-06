import type { PipelineJobStatus } from '@/db/pipeline-jobs';

/**
 * Compact, colored badge for a pipeline_jobs status. Reused on the
 * orders list, the detail page, and the queue tiles' summary row.
 *
 * Color mapping pinned by the spec — keep these in sync with the
 * StatusFilterChips active-state styling so the dashboard reads
 * consistently across views.
 */
const STATUS_CLASSES: Record<PipelineJobStatus, string> = {
  pending: 'bg-warm-grey-light text-near-black',
  running: 'bg-blue-100 text-blue-900',
  awaiting_review: 'bg-iron-oxide text-cream',
  shipped: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  cancelled: 'bg-warm-grey text-cream',
};

const STATUS_LABELS: Record<PipelineJobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  awaiting_review: 'Awaiting review',
  shipped: 'Shipped',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusBadge({ status }: { status: PipelineJobStatus }) {
  const classes = STATUS_CLASSES[status];
  return (
    <span
      className={`font-body text-caption px-sm py-xs inline-flex items-center rounded-full font-medium ${classes}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function statusLabel(status: PipelineJobStatus): string {
  return STATUS_LABELS[status];
}
