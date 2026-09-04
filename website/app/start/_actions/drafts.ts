'use server';

/**
 * Multi-draft / "start another" actions. A browser cookie can own several ACTIVE drafts (each
 * "start a new book" parks the previous one); getDraftByCookieId resolves the most-recently
 * opened as current. These actions let the customer create, switch between, and remove them.
 *
 * FLAG-GATED (MULTI_DRAFT_ENABLED, server-only, fail-closed): off → the actions are inert
 * (bounce to /start), so a stale client can't create/switch drafts. With the flag off no
 * second draft is ever created, so getDraftByCookieId behaves exactly as before.
 *
 * No cookie mutation: every draft shares the one cookie_id; "current" is decided by
 * last_opened_at, not by rewriting the cookie. Ownership is enforced (the target draft's
 * cookie_id must match the caller's cookie) so a draft id from the client can't reach another
 * browser's drafts.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import { draftHasSubstance } from '@/lib/draft-substance';
import {
  createDraft,
  getDraftByCookieId,
  getDraftById,
  touchDraftOpened,
  expireDraftNow,
} from '@/db/drafts';

const WIZARD_STEPS = new Set(['child', 'secondaries', 'theme', 'style', 'preview', 'review', 'payment']);
function stepPath(currentStep: string | null): string {
  return currentStep && WIZARD_STEPS.has(currentStep) ? `/start/${currentStep}` : '/start';
}

function multiDraftEnabled(): boolean {
  return process.env.MULTI_DRAFT_ENABLED === 'on';
}

/**
 * Start a fresh book. The one being left is PARKED only if it shows real intention/effort
 * (draftHasSubstance: past the character step OR a main photo uploaded); below that bar it's
 * silently discarded — expired so the reaper erases the row + any photos — so a barely-touched
 * draft never clutters "My books".
 */
export async function startNewBook(): Promise<void> {
  if (!multiDraftEnabled()) redirect('/start');
  const cookieId = await getDraftCookieFromRequest();
  // No cookie → let the proxy mint a first draft; nothing to preserve.
  if (!cookieId) redirect('/start');
  // Discard the draft being left when it's below the substance bar; otherwise leave it active
  // (parked). expireDraftNow rides the existing erasure (reaper unlinks photos) — no orphans.
  const current = await getDraftByCookieId(cookieId);
  if (current && !draftHasSubstance(current)) {
    await expireDraftNow(current.id);
  }
  // Same cookie_id → any kept draft stays active + parked; the new one's default last_opened_at
  // makes it current. Fresh drafts always begin at the child step.
  await createDraft(cookieId);
  revalidatePath('/start', 'layout');
  redirect('/start/child');
}

/** Switch the current draft to `draftId` (must belong to this cookie), landing on its step. */
export async function switchToDraft(draftId: string): Promise<void> {
  if (!multiDraftEnabled()) redirect('/start');
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start');
  const draft = await getDraftById(draftId);
  // Ownership: only switch to a draft this browser's cookie owns, and only an active one.
  if (!draft || draft.cookie_id !== cookieId || draft.status !== 'active') redirect('/start');
  await touchDraftOpened(draftId); // bumps last_opened_at → becomes current
  revalidatePath('/start', 'layout');
  redirect(stepPath(draft.current_step));
}

/** Remove a draft (must belong to this cookie). The reaper cleans up its row + photos. */
export async function deleteDraft(draftId: string): Promise<void> {
  if (!multiDraftEnabled()) redirect('/start');
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) redirect('/start');
  const draft = await getDraftById(draftId);
  if (!draft || draft.cookie_id !== cookieId) redirect('/start');
  await expireDraftNow(draftId);
  revalidatePath('/start', 'layout');
  redirect('/start'); // resolves to the next parked draft, or the proxy mints a fresh one
}
