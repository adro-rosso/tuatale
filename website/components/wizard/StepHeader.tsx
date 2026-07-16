'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { WIZARD_STEPS, isWizardStep, stepIndex, type WizardStep } from '@/lib/wizard-steps';

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
  bookType: string;
}

function heading(step: WizardStep, name: string | null, isPet: boolean): string {
  // `name` is the protagonist's name (the child's, or the pet's) once typed.
  switch (step) {
    case 'hero':
      return "Who's the book about?";
    case 'style':
      return 'Choose your art style';
    case 'child':
      return isPet ? 'About your pet' : 'About your child';
    case 'secondaries':
      return name ? `Friends and family for ${name}` : 'Friends and family';
    case 'theme':
      return name ? `Choose a theme for ${name}'s story` : 'Choose a theme';
    case 'preview':
      return name ? `See a glimpse of ${name}'s book` : 'See a glimpse';
    case 'review':
      return 'Review the details';
    case 'payment':
      return 'Almost there';
  }
  return name ?? 'them'; // unreachable, satisfies TS exhaustiveness
}

export function StepHeader({ childName, bookType }: StepHeaderProps) {
  const segment = useSelectedLayoutSegment();
  if (!segment || !isWizardStep(segment)) return null;
  const i = stepIndex(segment);

  return (
    <header className="px-lg pt-sm pb-md text-center">
      <p className="font-body text-warm-grey text-caption mb-xs tracking-[0.18em] uppercase">
        Step {i + 1} of {WIZARD_STEPS.length}
      </p>
      <h1 className="font-heading text-near-black text-title leading-[1.1]">
        {heading(segment, childName, bookType === 'pet')}
      </h1>
    </header>
  );
}
