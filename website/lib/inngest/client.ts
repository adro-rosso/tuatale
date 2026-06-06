/**
 * Inngest client for Tuatale.
 *
 * Phase 4 Track A uses Inngest as the job runtime: order webhook
 * dispatches a `pipeline/job.requested` event (Cycle A.3), this
 * client receives it on the /api/inngest endpoint, and the
 * runPipelineJob function executes the pipeline.
 *
 * Event/signing keys are read from the environment automatically:
 *   INNGEST_EVENT_KEY     — sending events to Inngest Cloud
 *   INNGEST_SIGNING_KEY   — verifying inbound Inngest webhooks
 *
 * In local dev (no env keys set), the SDK auto-switches to dev mode
 * and routes through the Inngest dev server on localhost:8288. See
 * `npm run dev:all` to start both servers together.
 */
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'tuatale',
});
