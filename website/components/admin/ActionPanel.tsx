import { Button } from '@/components/ui/Button';
import type { Tables } from '@/types/database';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';
import { CancelButton } from './CancelButton';

type PipelineJobRow = Tables<'pipeline_jobs'>;

interface ActionPanelProps {
  job: PipelineJobRow;
  saveNotesAction: (formData: FormData) => void | Promise<void>;
  shipAction: (formData: FormData) => void | Promise<void>;
  retryAction: (formData: FormData) => void | Promise<void>;
  cancelAction: (formData: FormData) => void | Promise<void>;
}

/**
 * Notes textarea + the status-appropriate action buttons in one
 * form. Every action button uses `formAction` to dispatch the
 * server action, so they all share the same FormData (including
 * the notes textarea) — Save persists notes alone, Ship/Retry/
 * Cancel persist notes AND transition status.
 *
 * The transitions valid from each from-status:
 *   awaiting_review → Ship | Cancel
 *   failed          → Retry | Cancel
 *   pending/running → no actions (waiting on pipeline)
 *   shipped/cancelled → no actions (terminal)
 */
export function ActionPanel({
  job,
  saveNotesAction,
  shipAction,
  retryAction,
  cancelAction,
}: ActionPanelProps) {
  const status = job.status as PipelineJobStatus;
  const canShip = status === 'awaiting_review';
  const canRetry = status === 'failed';
  const canCancel = status === 'pending' || status === 'awaiting_review' || status === 'failed';
  const isTerminal = status === 'shipped' || status === 'cancelled';

  if (isTerminal) {
    return (
      <section className="space-y-sm">
        <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">Actions</h2>
        <p className="font-body text-warm-grey text-body">
          This job is in a terminal state. No further actions.
        </p>
      </section>
    );
  }

  if (status === 'running') {
    return (
      <section className="space-y-sm">
        <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">Actions</h2>
        <p className="font-body text-warm-grey text-body">
          Pipeline is running. Wait for it to reach awaiting review before shipping.
        </p>
      </section>
    );
  }

  return (
    <form className="space-y-md">
      <div className="space-y-xs">
        <label
          htmlFor="review_notes"
          className="font-body text-warm-grey text-caption block tracking-wider uppercase"
        >
          Notes
        </label>
        <textarea
          id="review_notes"
          name="review_notes"
          rows={3}
          defaultValue={job.review_notes ?? ''}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none"
          placeholder="Optional notes saved with whichever action you take."
        />
      </div>

      <div className="gap-sm flex flex-wrap items-center">
        <Button type="submit" variant="secondary" formAction={saveNotesAction}>
          Save notes
        </Button>
        {canShip && (
          <Button type="submit" variant="primary" formAction={shipAction}>
            Ship to customer
          </Button>
        )}
        {canRetry && (
          <Button type="submit" variant="primary" formAction={retryAction}>
            Retry
          </Button>
        )}
        {canCancel && <CancelButton action={cancelAction} />}
      </div>

      {status === 'pending' && (
        <p className="font-body text-warm-grey text-caption">
          Pipeline hasn&apos;t picked this job up yet. You can cancel while it&apos;s waiting.
        </p>
      )}
    </form>
  );
}
