'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { WIZARD_STEPS, isWizardStep, stepIndex } from '@/lib/wizard-steps';

/**
 * Six-dot row showing the customer's position in the wizard. The dot for
 * the current URL segment is iron-oxide; preceding dots are also iron-
 * oxide (steps already passed through); following dots are warm-grey-
 * light. Phase 2.C+ might add ticks for completed steps.
 *
 * Client component — uses useSelectedLayoutSegment to read the active
 * /start/<segment> from the App Router without forcing the whole layout
 * to render on the client.
 */
export function ProgressIndicator() {
  const segment = useSelectedLayoutSegment();
  const currentIdx = segment && isWizardStep(segment) ? stepIndex(segment) : -1;

  return (
    <nav
      aria-label="Wizard progress"
      className="px-lg py-md gap-sm flex items-center justify-center"
    >
      {WIZARD_STEPS.map((step, i) => {
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;
        const filled = isCurrent || isPast;
        return (
          <span
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`Step ${i + 1} of ${WIZARD_STEPS.length}: ${step}`}
            className={`h-sm rounded-full transition-colors ${
              isCurrent ? 'w-xl' : 'w-sm'
            } ${filled ? 'bg-iron-oxide' : 'bg-warm-grey-light'}`}
          />
        );
      })}
    </nav>
  );
}
