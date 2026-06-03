import { redirect } from 'next/navigation';
import { getDraft } from '@/lib/draft-fetch';
import { isWizardStep, stepPath } from '@/lib/wizard-steps';

/**
 * /start — entry point for the wizard.
 *
 * The proxy has already minted the draft cookie (if needed) by the
 * time this renders. We redirect to whichever step the customer last
 * reached: a brand-new draft sits at current_step='child' (DB default),
 * so first-time visitors land on /start/child; returning visitors with
 * a partly-filled draft land on the furthest step they reached.
 *
 * Belt-and-suspenders: if the draft lookup somehow fails or the
 * current_step value isn't a recognised step (shouldn't happen given
 * the DB CHECK), fall back to /start/child.
 */
export default async function StartPage(): Promise<never> {
  const result = await getDraft();
  if (result.kind === 'found' && isWizardStep(result.draft.current_step)) {
    redirect(stepPath(result.draft.current_step));
  }
  redirect('/start/child');
}
