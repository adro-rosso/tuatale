import type { Tables } from '@/types/database';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';
import { formatPrice } from '@/lib/pricing';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';

type OrderRow = Tables<'orders'>;
type PipelineJobRow = Tables<'pipeline_jobs'>;

/**
 * Top section of the detail page. Customer / payment / job-id
 * overview + a prominent StatusBadge so the admin sees lifecycle
 * state at a glance.
 */
export function OrderSummarySection({ order, job }: { order: OrderRow; job: PipelineJobRow }) {
  return (
    <section className="border-warm-grey-light bg-cream p-md space-y-sm rounded-md border">
      <div className="gap-md flex flex-wrap items-start justify-between">
        <div className="space-y-xs">
          <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">Order</h2>
          <p className="font-body text-near-black text-body">
            <span className="font-mono">{order.id.slice(0, 8)}</span> ·{' '}
            <span className="font-mono">{order.stripe_session_id.slice(0, 14)}…</span>
          </p>
          <p className="font-body text-warm-grey text-caption">
            Paid <RelativeTime iso={order.paid_at} /> ·{' '}
            <span className="tabular-nums">
              {formatPrice(order.amount_paid_cents, order.currency as 'aud')}
            </span>
          </p>
        </div>
        <StatusBadge status={job.status as PipelineJobStatus} />
      </div>
      <div className="border-warm-grey-light pt-sm space-y-xs border-t">
        <p className="font-body text-near-black text-body">
          <span className="text-warm-grey text-caption tracking-wider uppercase">Customer</span>{' '}
          {order.customer_email}
        </p>
      </div>
    </section>
  );
}
