/**
 * GET /api/internal/reap — E1 retention cascade (expired drafts + their photos).
 *
 * Replaces the pg_cron `delete from public.drafts` job, which could only reap ROWS:
 * Postgres has no way to delete the Storage BYTES (removing a `storage.objects` row
 * leaves the object in S3), so every reap left the photos behind — and orphaned them,
 * since the row was the only link back to the customer. Vercel Cron drives it now,
 * where the service-role Storage API is reachable.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Same shape as
 * /api/internal/recover — not public.
 *
 * DRY-RUN BY DEFAULT for manual calls. The cron passes ?apply=1 to actually delete;
 * hitting the URL by hand shows you what WOULD go without touching anything.
 */
import { NextResponse } from 'next/server';
import { reapExpiredDrafts } from '@/lib/retention/reap-drafts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'reap not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('apply') !== '1';
  try {
    const report = await reapExpiredDrafts({ dryRun });
    // Errors are collected, not thrown: one bad draft must not stop the rest, and a
    // draft whose Storage delete failed keeps its row so the next run can retry it.
    if (report.errors.length) console.error('[reap] partial failure', report.errors);
    console.log(
      `[reap] ${dryRun ? 'DRY-RUN' : 'APPLIED'} drafts=${report.draftsReaped} ` +
        `photos=${report.photosDeleted.length} retained=${report.photosRetained.length} errors=${report.errors.length}`,
    );
    return NextResponse.json({ ok: report.errors.length === 0, ...report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? 'reap failed' }, { status: 500 });
  }
}
