/**
 * POST /api/internal/recover — R2 terminal-failure recovery entry point.
 *
 * Called by the worker's onFailure after markFailed/markPreviewFailed. The worker
 * can't import the website's Stripe/Resend/orders plumbing (separate runtime), and
 * there's no Inngest function host on the website — so the worker fans the failure
 * here and this route runs the recovery (refund + customer email + status sync for
 * paid orders; ops-alert for all). Idempotent (see handleFailure).
 *
 * Auth: a shared bearer secret (INTERNAL_RECOVERY_SECRET) — not public.
 */
import { NextResponse } from 'next/server';
import { handleFailure, type FailureInput } from '@/lib/recovery/recover-failed-order';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.INTERNAL_RECOVERY_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'recovery not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let input: FailureInput;
  try {
    input = (await req.json()) as FailureInput;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (input?.source !== 'order' && input?.source !== 'preview') {
    return NextResponse.json({ error: 'invalid source' }, { status: 400 });
  }

  try {
    const result = await handleFailure(input);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    // The failure itself is already durable in pipeline_jobs (markFailed ran in the
    // worker before this call). Return 500 so the worker's notify retry + Sentry
    // see it — don't 200-mask a recovery that didn't happen.
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? 'recovery failed' }, { status: 500 });
  }
}
