import type { Tables } from '@/types/database';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';
import { STUB_PDF_URL } from '@/lib/inngest/functions/run-pipeline-job';
import { statusLabel } from './StatusBadge';

type PipelineJobRow = Tables<'pipeline_jobs'>;

/**
 * Three-state PDF preview:
 *
 *   - pdf_url is the Cycle A.2 stub URL → placeholder panel,
 *     pipeline integration (Track B) hasn't landed yet.
 *   - pdf_url present and real → iframe at 450px tall with a
 *     download link below. Browsers render PDFs natively in iframe
 *     so admin can scroll through without leaving the page.
 *   - pdf_url null → "pipeline hasn't produced the PDF yet" message
 *     with the current status so admin knows where it stands.
 */
export function PdfPreviewSection({ job }: { job: PipelineJobRow }) {
  return (
    <section className="space-y-sm">
      <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">
        PDF preview
      </h2>
      {renderContent(job)}
    </section>
  );
}

function renderContent(job: PipelineJobRow) {
  if (job.pdf_url === STUB_PDF_URL) {
    return (
      <div className="border-warm-grey-light bg-cream p-md rounded-md border">
        <p className="font-body text-near-black text-body">
          PDF preview unavailable — this is a stub job from before Track B pipeline integration. A
          real PDF will appear here once Track B completes.
        </p>
        <p className="font-body text-warm-grey text-caption mt-xs">
          Stub URL: <span className="font-mono">{job.pdf_url}</span>
        </p>
      </div>
    );
  }

  if (job.pdf_url) {
    return (
      <div className="border-warm-grey-light bg-cream space-y-sm overflow-hidden rounded-md border">
        <iframe
          src={job.pdf_url}
          title="Book PDF preview"
          className="block w-full"
          style={{ height: 450 }}
        />
        <div className="px-md py-sm">
          <a href={job.pdf_url} className="text-iron-oxide font-medium hover:underline" download>
            Download PDF
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="border-warm-grey-light bg-cream p-md rounded-md border">
      <p className="font-body text-warm-grey text-body">
        Pipeline hasn&apos;t produced a PDF yet (current status:{' '}
        {statusLabel(job.status as PipelineJobStatus).toLowerCase()}).
      </p>
    </div>
  );
}
