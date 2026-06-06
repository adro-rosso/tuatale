import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getJobById } from '@/db/pipeline-jobs';
import { getOrderById } from '@/db/orders';
import { Heading } from '@/components/ui/Heading';
import { OrderSummarySection } from '@/components/admin/OrderSummarySection';
import { BookContentSection } from '@/components/admin/BookContentSection';
import { PdfPreviewSection } from '@/components/admin/PdfPreviewSection';
import { JobExecutionDetail } from '@/components/admin/JobExecutionDetail';
import { ActionPanel } from '@/components/admin/ActionPanel';
import { saveNotesAction } from './_actions/save-notes';
import { shipJobAction } from './_actions/ship-job';
import { retryJobAction } from './_actions/retry-job';
import { cancelJobAction } from './_actions/cancel-job';

/**
 * Job detail page. One pipeline job + its associated order. 404
 * when either is missing.
 *
 * Server-rendered top-to-bottom. The four sections are pure data
 * display; the bottom Action panel binds the four Server Actions
 * to the job id and renders the buttons that match the current
 * status.
 *
 * After any action runs, the redirect (Ship/Cancel back to list,
 * Retry stays here) + revalidatePath in the action keep the data
 * fresh on the next render.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJobById(id);
  if (!job) notFound();
  const order = await getOrderById(job.order_id);
  if (!order) notFound();

  return (
    <div className="space-y-lg">
      <div className="space-y-xs">
        <Link
          href="/admin/orders"
          className="font-body text-warm-grey text-caption hover:text-iron-oxide hover:underline"
        >
          ← Back to queue
        </Link>
        <Heading level="2" className="not-italic">
          {order.child_name}&apos;s book
        </Heading>
      </div>

      <OrderSummarySection order={order} job={job} />
      <BookContentSection order={order} />
      <PdfPreviewSection job={job} />
      <JobExecutionDetail job={job} />
      <ActionPanel
        job={job}
        saveNotesAction={saveNotesAction.bind(null, job.id)}
        shipAction={shipJobAction.bind(null, job.id)}
        retryAction={retryJobAction.bind(null, job.id)}
        cancelAction={cancelJobAction.bind(null, job.id)}
      />
    </div>
  );
}
