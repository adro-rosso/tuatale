import Link from 'next/link';
import type { Tables } from '@/types/database';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';
import { StatusBadge, statusLabel } from './StatusBadge';
import { RelativeTime } from './RelativeTime';

type PipelineJobRow = Tables<'pipeline_jobs'>;
type OrderRow = Tables<'orders'>;

interface OrderListRow {
  job: PipelineJobRow;
  order: OrderRow | null;
}

interface OrderListProps {
  rows: ReadonlyArray<OrderListRow>;
  filterStatus: PipelineJobStatus;
}

/**
 * The orders table itself. One row per pipeline job in the current
 * filter. Each row links to /admin/orders/[job.id] via a "Review"
 * action; no inline editing — all status transitions happen on the
 * detail page.
 *
 * order is `null` when the job's FK points at a deleted order
 * (shouldn't happen under ON DELETE RESTRICT but we render
 * gracefully if it does — render dashes for the order-derived
 * fields rather than crashing).
 */
export function OrderList({ rows, filterStatus }: OrderListProps) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-warm-grey text-body py-xl text-center">
        No orders {statusLabel(filterStatus).toLowerCase()}.
      </p>
    );
  }

  return (
    <div className="border-warm-grey-light overflow-x-auto rounded-md border">
      <table className="w-full border-collapse">
        <thead className="bg-cream-deep text-near-black">
          <tr className="text-left">
            <Th>Status</Th>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th>Book</Th>
            <Th>Created</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, order }) => {
            const shortId = order?.id.slice(0, 8) ?? '—';
            const customerName = order?.child_name
              ? `${order.child_name}'s parent`
              : '—';
            const themeExcerpt = order?.theme
              ? order.theme.length > 60
                ? `${order.theme.slice(0, 60)}…`
                : order.theme
              : '—';
            return (
              <tr
                key={job.id}
                className="border-warm-grey-light bg-cream hover:bg-cream-deep border-t transition-colors"
              >
                <Td>
                  <StatusBadge status={job.status as PipelineJobStatus} />
                </Td>
                <Td className="font-mono tabular-nums">{shortId}</Td>
                <Td>
                  <div>{customerName}</div>
                  {order?.customer_email && (
                    <div className="text-warm-grey text-caption">{order.customer_email}</div>
                  )}
                </Td>
                <Td>
                  <div className="font-medium">{order?.child_name ?? '—'}</div>
                  <div className="text-warm-grey text-caption">{themeExcerpt}</div>
                </Td>
                <Td>
                  <RelativeTime iso={job.created_at} />
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/admin/orders/${job.id}`}
                    className="text-iron-oxide font-medium hover:underline"
                  >
                    Review →
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`font-body text-caption px-md py-sm font-medium tracking-wider uppercase ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`font-body text-body px-md py-sm align-top ${className}`}>{children}</td>
  );
}
