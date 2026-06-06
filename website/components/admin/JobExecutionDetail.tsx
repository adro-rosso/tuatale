import type { Tables } from '@/types/database';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';

type PipelineJobRow = Tables<'pipeline_jobs'>;

/**
 * Status timeline + retry metadata + generation_metadata blob +
 * error blob (when present). Everything the admin needs to triage
 * a job without leaving the page.
 *
 * Timeline is rendered from the column timestamps directly — no
 * separate events table. created -> started -> completed/failed/
 * shipped, with reasons inline where applicable.
 *
 * Inngest IDs are surfaced as plain text. Constructing a clickable
 * link to the Inngest dashboard requires knowing the environment
 * name (prod vs branch) which we don't currently track. Admin can
 * paste the run id into Inngest's search box.
 */
export function JobExecutionDetail({ job }: { job: PipelineJobRow }) {
  return (
    <section className="space-y-md">
      <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">
        Job execution
      </h2>

      <div className="border-warm-grey-light bg-cream p-md space-y-sm rounded-md border">
        <div className="gap-md flex items-center">
          <StatusBadge status={job.status as PipelineJobStatus} />
          <span className="font-body text-warm-grey text-caption">
            Attempt {job.attempt_count + 1}
          </span>
        </div>

        <Timeline job={job} />

        {(job.inngest_event_id || job.inngest_run_id) && (
          <div className="border-warm-grey-light pt-sm space-y-xs border-t">
            {job.inngest_event_id && (
              <p className="font-body text-caption text-near-black">
                <Label>Inngest event</Label>
                <span className="font-mono">{job.inngest_event_id}</span>
              </p>
            )}
            {job.inngest_run_id && (
              <p className="font-body text-caption text-near-black">
                <Label>Inngest run</Label>
                <span className="font-mono">{job.inngest_run_id}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {job.generation_metadata && (
        <div className="space-y-xs">
          <h3 className="font-body text-warm-grey text-caption tracking-wider uppercase">
            Generation metadata
          </h3>
          <pre className="border-warm-grey-light bg-cream-deep text-near-black text-caption p-md overflow-auto rounded-md border font-mono">
            {JSON.stringify(job.generation_metadata, null, 2)}
          </pre>
        </div>
      )}

      {(job.error_message || job.error_details) && (
        <div className="space-y-xs">
          <h3 className="font-body text-caption tracking-wider text-red-700 uppercase">Error</h3>
          {job.error_message && (
            <p className="font-body text-body text-red-700">{job.error_message}</p>
          )}
          {job.error_details && (
            <pre className="border-warm-grey-light bg-cream-deep text-caption p-md overflow-auto rounded-md border font-mono text-red-900">
              {JSON.stringify(job.error_details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {job.review_notes && (
        <div className="space-y-xs">
          <h3 className="font-body text-warm-grey text-caption tracking-wider uppercase">
            Last saved notes
          </h3>
          <p className="font-body text-near-black text-body whitespace-pre-wrap">
            {job.review_notes}
          </p>
          {job.reviewed_by && (
            <p className="font-body text-warm-grey text-caption">— {job.reviewed_by}</p>
          )}
        </div>
      )}
    </section>
  );
}

function Timeline({ job }: { job: PipelineJobRow }) {
  const events: Array<{ label: string; iso: string | null }> = [
    { label: 'Created', iso: job.created_at },
    { label: 'Started', iso: job.started_at },
    { label: 'Completed', iso: job.completed_at },
    { label: 'Shipped', iso: job.shipped_at },
    { label: 'Failed', iso: job.failed_at },
  ];
  return (
    <ul className="space-y-xs">
      {events
        .filter((e) => e.iso !== null)
        .map((e) => (
          <li key={e.label} className="font-body text-caption gap-md flex items-baseline">
            <Label>{e.label}</Label>
            <RelativeTime iso={e.iso} />
          </li>
        ))}
    </ul>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-warm-grey inline-block min-w-[100px] tracking-wider uppercase">
      {children}
    </span>
  );
}
