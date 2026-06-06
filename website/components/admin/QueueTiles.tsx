import Link from 'next/link';
import { PIPELINE_JOB_STATUSES, type PipelineJobStatus } from '@/db/pipeline-jobs';
import { statusLabel } from './StatusBadge';

/**
 * Summary tile row across the top of every admin page. Each tile
 * shows the count of jobs in a given status and links to that
 * filtered slice of the queue. The "Awaiting review" tile is
 * highlighted because it's the priority queue — the work item
 * driving every admin session.
 *
 * Counts come from the parent layout's pipelineJobs.countJobsByStatus()
 * call so all tiles refresh together when the layout re-renders.
 */
interface QueueTilesProps {
  counts: Record<PipelineJobStatus, number>;
}

export function QueueTiles({ counts }: QueueTilesProps) {
  return (
    <nav aria-label="Queue summary" className="gap-sm flex flex-wrap items-stretch">
      {PIPELINE_JOB_STATUSES.map((status) => {
        const isPriority = status === 'awaiting_review';
        const tileClasses = isPriority
          ? 'bg-iron-oxide text-cream border-iron-oxide'
          : 'bg-cream text-near-black border-warm-grey-light hover:border-iron-oxide';
        return (
          <Link
            key={status}
            href={`/admin/orders?status=${status}`}
            className={`font-body px-md py-sm min-w-[110px] flex-1 rounded-md border transition-colors ${tileClasses}`}
          >
            <span className="text-caption block tracking-wider uppercase opacity-80">
              {statusLabel(status)}
            </span>
            <span className="font-heading text-h2 block not-italic tabular-nums">
              {counts[status]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
