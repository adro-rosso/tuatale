import type { Tables } from '@/types/database';
import { RelativeTime } from './RelativeTime';

type PipelineJobRow = Tables<'pipeline_jobs'>;

/**
 * Renders the ship-notification email outcome for a job.
 *
 * Three states, matching the three notification_* columns:
 *
 *   - sent: green dot + "Email sent {relativeTime}" + the Resend
 *     message id underneath for cross-reference with the Resend
 *     dashboard.
 *
 *   - failed: red dot + the error message. Includes the
 *     stub-PDF skip case (which records a synthetic error string)
 *     so admin sees a clear "we did NOT email the customer"
 *     signal rather than nothing.
 *
 *   - not attempted: nothing rendered. Caller (JobExecutionDetail)
 *     decides whether to even show the wrapping section.
 *
 * `hasEmailActivity` is a small exported helper so the parent can
 * skip rendering its section header when there's nothing to show.
 */
export function hasEmailActivity(job: PipelineJobRow): boolean {
  return job.notification_sent_at !== null || job.notification_error !== null;
}

export function EmailStatusIndicator({ job }: { job: PipelineJobRow }) {
  if (job.notification_sent_at) {
    return (
      <div className="gap-sm flex items-start">
        <Dot color="#1f7a4d" />
        <div className="space-y-xs">
          <p className="font-body text-near-black text-body">
            Email sent <RelativeTime iso={job.notification_sent_at} />
          </p>
          {job.notification_message_id && (
            <p className="font-body text-warm-grey text-caption">
              Resend message id: <span className="font-mono">{job.notification_message_id}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (job.notification_error) {
    return (
      <div className="gap-sm flex items-start">
        <Dot color="#b3261e" />
        <div className="space-y-xs">
          <p className="font-body text-body text-red-800">Email not sent</p>
          <p className="font-body text-warm-grey text-caption">{job.notification_error}</p>
        </div>
      </div>
    );
  }

  return null;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className="mt-xs inline-block h-2 w-2 shrink-0 rounded-full"
    />
  );
}
