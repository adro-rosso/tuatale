'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { WIZARD_STEPS, isWizardStep, stepIndex, type WizardStep } from '@/lib/wizard-steps';
import { Heading } from '@/components/ui/Heading';
import { Body } from '@/components/ui/Body';

/**
 * Step header — renders the "Step N of 6" caption and the personalised
 * heading for the current step.
 *
 * Client component (segment-aware via useSelectedLayoutSegment) so the
 * Server-rendered layout doesn't have to thread the active step down
 * via props. childName comes from the parent layout (which reads it
 * from the cached draft fetch) and is null on the very first visit
 * before the customer has typed it.
 */
interface StepHeaderProps {
  childName: string | null;
}

function heading(step: WizardStep, childName: string | null): string {
  // Fallback: when child_name isn't known yet (step 1 itself or
  // brand-new draft), use the neutral wording.
  const them = childName ?? 'them';
  switch (step) {
    case 'child':
      return 'About your child';
    case 'secondaries':
      return childName ? `Friends and family for ${childName}` : 'Friends and family';
    case 'theme':
      return childName ? `Choose a theme for ${childName}'s story` : 'Choose a theme';
    case 'preview':
      return childName ? `See a glimpse of ${childName}'s book` : 'See a glimpse';
    case 'review':
      return 'Review the details';
    case 'payment':
      return 'Almost there';
  }
  return them; // unreachable, satisfies TS exhaustiveness
}

export function StepHeader({ childName }: StepHeaderProps) {
  const segment = useSelectedLayoutSegment();
  if (!segment || !isWizardStep(segment)) return null;
  const i = stepIndex(segment);

  return (
    <header className="px-lg pt-md pb-lg text-center">
      <Body size="caption" className="mb-xs tracking-wider uppercase">
        Step {i + 1} of {WIZARD_STEPS.length}
      </Body>
      <Heading level="2" italic>
        {heading(segment, childName)}
      </Heading>
    </header>
  );
}
