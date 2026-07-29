import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getJobById } from '@/db/pipeline-jobs';
import { getOrderById } from '@/db/orders';
import { getOrderPhotos } from '@/lib/photos/order-photos';
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

  // Reference photos are signed per render with a short-lived URL (never public, never
  // persisted). getOrderPhotos never throws — a Storage problem degrades to a per-photo
  // 'error' tile so the page an operator uses to decide whether to ship still renders.
  const photos = await getOrderPhotos(order);

  // Character-picker Slice 4: was any chosen character pick lost (durable copy/PNG gone),
  // so this book was made from photos instead of the exact pick? (Types lag the migration.)
  const chosenP = (order as { chosen_sheet?: { degraded?: boolean; degradedReason?: string } | null }).chosen_sheet;
  const secsForFlag = (order as { secondaries?: Array<{ chosen_sheet?: { degraded?: boolean } }> | null }).secondaries;
  const degradedPick =
    Boolean(chosenP?.degraded) || (Array.isArray(secsForFlag) && secsForFlag.some((s) => s?.chosen_sheet?.degraded));
  const degradedReason = chosenP?.degradedReason ?? 'unavailable at generation';

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

      {degradedPick ? (
        <div className="border-iron-oxide/40 bg-iron-oxide/5 space-y-xs rounded-2xl border p-md" role="alert">
          <p className="font-body text-near-black text-body">⚑ Character pick lost — book made from photos.</p>
          <p className="font-body text-warm-grey text-caption">
            The customer chose a specific character look, but its saved image was {degradedReason}, so this book was
            generated from their photos (good likeness via face-selection, but not the exact pick they chose). Recourse
            is manual for now — regenerate the book, or accept the good-photo result. (One-click sheet re-roll to restore
            the exact pick is a planned follow-up, not yet built.)
          </p>
        </div>
      ) : null}

      <OrderSummarySection order={order} job={job} />
      <BookContentSection order={order} photos={photos} />
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
