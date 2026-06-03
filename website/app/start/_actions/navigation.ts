'use server';

/**
 * Wizard navigation Server Actions. Called from each step page's
 * <WizardNav> client component. Two responsibilities:
 *
 *   1. Validate the requested step transition against WIZARD_STEPS order
 *      (can't skip from /start/child to /start/review).
 *   2. Persist forward progress on the draft so a customer returning to
 *      /start in a fresh tab lands on the furthest step they reached.
 *
 * Going BACKWARD never rewinds the draft's current_step — backwards is
 * just navigation, not undoing progress. If you went forward to /theme,
 * went back to /child, then opened a new tab and hit /start, you should
 * still land on /theme.
 *
 * Cookies + draft lookup happen inside each action via the standard
 * server-only helpers — we don't pass IDs through hidden form inputs
 * because the cookie is already authenticated (httpOnly, server-set).
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { drafts } from '@/db';
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';
import {
  type WizardStep,
  isWizardStep,
  stepIndex,
  stepPath,
  nextStep,
  previousStep,
} from '@/lib/wizard-steps';
import { InvalidTransitionError } from './errors';

/**
 * Move from `from` to the next step. Throws InvalidTransitionError if
 * `from` is already the last step. Updates draft.current_step to record
 * the new furthest-step-reached.
 */
export async function advanceStep(from: WizardStep): Promise<void> {
  const next = nextStep(from);
  if (!next) {
    throw new InvalidTransitionError(from, 'advance');
  }
  await persistAndRedirect(from, next, 'advance');
}

/**
 * Move from `from` to the previous step. Throws if `from` is the first
 * step. Does NOT rewind draft.current_step — backwards navigation is
 * just browsing.
 */
export async function goBack(from: WizardStep): Promise<void> {
  const prev = previousStep(from);
  if (!prev) {
    throw new InvalidTransitionError(from, 'back');
  }
  await persistAndRedirect(from, prev, 'back');
}

async function persistAndRedirect(
  from: WizardStep,
  to: WizardStep,
  direction: 'advance' | 'back',
): Promise<never> {
  const cookieId = await getDraftCookieFromRequest();
  if (!cookieId) {
    // No cookie — proxy should have set one. Bounce to /start so proxy
    // gets another shot at minting.
    redirect('/start');
  }
  const draft = await drafts.getDraftByCookieId(cookieId);
  if (!draft) {
    // Cookie present but no draft (stale, expired, converted). Bounce
    // to /start — proxy will mint a fresh cookie + draft pair.
    redirect('/start');
  }

  // Persist forward progress only. Backwards navigation doesn't rewind
  // current_step: the customer's "furthest reached" is sticky.
  if (direction === 'advance') {
    const currentReached: WizardStep = isWizardStep(draft.current_step) ? draft.current_step : from;
    if (stepIndex(to) > stepIndex(currentReached)) {
      await drafts.updateDraft(draft.id, { current_step: to });
      // Layout cache holds the draft snapshot used by StepHeader +
      // PricePanel; advancing changes current_step, which the /start
      // resume route reads, so flush here too.
      revalidatePath('/start', 'layout');
    }
  }

  redirect(stepPath(to));
}
