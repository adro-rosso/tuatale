import { getJobsByStatus, PIPELINE_JOB_STATUSES, type PipelineJobStatus } from '@/db/pipeline-jobs';
import { getOrderById } from '@/db/orders';
import { OrderList } from '@/components/admin/OrderList';
import { StatusFilterChips } from '@/components/admin/StatusFilterChips';
import { Heading } from '@/components/ui/Heading';
import { statusLabel } from '@/components/admin/StatusBadge';

const DEFAULT_STATUS: PipelineJobStatus = 'awaiting_review';
const PAGE_LIMIT = 50;

function parseStatus(raw: string | undefined): PipelineJobStatus {
  if (raw && (PIPELINE_JOB_STATUSES as readonly string[]).includes(raw)) {
    return raw as PipelineJobStatus;
  }
  return DEFAULT_STATUS;
}

/**
 * /admin/orders — the queue. Reads ?status=<X> from searchParams to
 * filter; defaults to awaiting_review because that's the work item
 * driving every admin session.
 *
 * For each job we also fetch its associated order so the list can
 * surface customer-facing data (name, email, theme excerpt). The
 * per-job order fetch is N+1 by design — admin volume at v1 will be
 * <100 rows per page and the simpler shape is easier to debug than
 * a joined RPC. Future optimization: a single `select('*, orders(*)')`
 * once admin traffic actually warrants it.
 *
 * Jobs are returned oldest-first by getJobsByStatus so the admin
 * works the longest-waiting customer first.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = parseStatus(rawStatus);

  const jobs = await getJobsByStatus(status, { limit: PAGE_LIMIT });
  // Fetch orders in parallel — keeps the round-trip count visible
  // without making the page wait serially on each lookup.
  const rows = await Promise.all(
    jobs.map(async (job) => ({
      job,
      order: await getOrderById(job.order_id),
    })),
  );

  return (
    <div className="space-y-lg">
      <div className="space-y-sm">
        <Heading level="2" className="not-italic">
          {statusLabel(status)}
        </Heading>
        <p className="font-body text-warm-grey text-caption">
          {jobs.length === PAGE_LIMIT
            ? `Showing the oldest ${PAGE_LIMIT} — refresh after working through them.`
            : `${jobs.length} ${jobs.length === 1 ? 'order' : 'orders'}.`}
        </p>
      </div>

      <StatusFilterChips active={status} />

      <OrderList rows={rows} filterStatus={status} />
    </div>
  );
}
