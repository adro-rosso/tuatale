'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { isWizardStep, nextStep, previousStep } from '@/lib/wizard-steps';
import { advanceStep, goBack } from '@/app/start/_actions/navigation';
import { Button } from '@/components/ui/Button';

/**
 * Back / Next button row pinned to the bottom of the wizard layout.
 * Each button is wrapped in a <form> whose action is the appropriate
 * Server Action with the current step bound — Next 16's Server-Action-
 * via-form pattern.
 *
 * - First step (/start/child): no Back button.
 * - Last step (/start/payment): no Next button (the payment step will
 *   have its own checkout submission; Phase 2.E wires that).
 * - Anywhere else: both buttons shown.
 *
 * The placeholder copy uses our brand voice — "Continue" rather than
 * the more typical "Next" — to match the warm-literary tone. Easy to
 * adjust per-step in Phase 2.C if step-specific copy reads better.
 */
export function WizardNav() {
  const segment = useSelectedLayoutSegment();
  if (!segment || !isWizardStep(segment)) return null;

  const canBack = previousStep(segment) !== null;
  const canNext = nextStep(segment) !== null;
  const advance = advanceStep.bind(null, segment);
  const back = goBack.bind(null, segment);

  return (
    <footer className="border-warm-grey-light bg-cream border-t">
      <div className="px-lg py-lg gap-md mx-auto flex max-w-[720px] items-center justify-between">
        {canBack ? (
          <form action={back}>
            <Button variant="ghost" type="submit">
              ← Back
            </Button>
          </form>
        ) : (
          <span aria-hidden />
        )}
        {canNext ? (
          <form action={advance}>
            <Button variant="primary" type="submit">
              Continue →
            </Button>
          </form>
        ) : (
          <span aria-hidden />
        )}
      </div>
    </footer>
  );
}
