/**
 * Inngest webhook endpoint.
 *
 * Inngest's cloud reaches into our deploy through this URL: it
 * fetches function metadata via GET, processes events via POST, and
 * registers function changes via PUT.
 *
 * After a Vercel deploy, the Inngest dashboard auto-detects the
 * functions exposed here (provided the deployment has been "synced"
 * once in the dashboard for the first deploy).
 *
 * Force the route to the Node runtime — Inngest's signing-key
 * verification uses Node crypto, same constraint as the Stripe
 * webhook handler.
 */
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { runPipelineJob } from '@/lib/inngest/functions';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runPipelineJob],
});
