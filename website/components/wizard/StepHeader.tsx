'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { WIZARD_STEPS, STEP_HEADINGS, isWizardStep, stepIndex } from '@/lib/wizard-steps';
import { Heading } from '@/components/ui/Heading';
import { Body } from '@/components/ui/Body';

/**
 * Renders the wizard's current-step heading + a small "Step N of 6"
 * caption. Client component (segment-aware) so the layout doesn't have
 * to thread the step value through props.
 *
 * Returns null when the segment isn't a recognised wizard step (covers
 * /start itself, which redirects to /start/child before render).
 */
export function StepHeader() {
  const segment = useSelectedLayoutSegment();
  if (!segment || !isWizardStep(segment)) return null;
  const i = stepIndex(segment);
  const heading = STEP_HEADINGS[segment];

  return (
    <header className="px-lg pt-md pb-lg text-center">
      <Body size="caption" className="mb-xs tracking-wider uppercase">
        Step {i + 1} of {WIZARD_STEPS.length}
      </Body>
      <Heading level="2" italic>
        {heading}
      </Heading>
    </header>
  );
}
