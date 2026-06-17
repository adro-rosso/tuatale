/**
 * Wizard step list — the single source of truth for the seven form steps.
 *
 * The string union and the WIZARD_STEPS array are kept in lockstep with
 * the schema's `drafts.current_step` CHECK constraint. If you change one,
 * change the other and the SQL migration that defines the enum.
 *
 * `style` is FIRST (W-F): the character previews render in the chosen art
 * style, so the customer must pick a style before the character step.
 *
 * Used by:
 *   - the navigation Server Actions (validate step transitions)
 *   - the WizardLayout chrome (compute progress + neighbour steps)
 *   - each step page's `<WizardNav>` (knows where Back / Next go)
 */
export type WizardStep = 'style' | 'child' | 'secondaries' | 'theme' | 'preview' | 'review' | 'payment';

export const WIZARD_STEPS: readonly WizardStep[] = [
  'style',
  'child',
  'secondaries',
  'theme',
  'preview',
  'review',
  'payment',
] as const;

/**
 * Customer-facing step copy. Headings appear in the layout's StepHeader.
 * Keep the brand voice: warm-literary, never showy.
 */
export const STEP_HEADINGS: Record<WizardStep, string> = {
  style: 'Choose your art style',
  child: 'About your child',
  secondaries: 'Friends, pets, or favourite toys',
  theme: 'Choose a theme',
  preview: 'See a glimpse',
  review: 'Review the details',
  payment: 'Almost there',
};

export function isWizardStep(value: string): value is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(value);
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/**
 * The step BEFORE `step` in the wizard order, or null if `step` is the
 * first one (no "back" from /start/child).
 */
export function previousStep(step: WizardStep): WizardStep | null {
  const i = stepIndex(step);
  return i > 0 ? (WIZARD_STEPS[i - 1] ?? null) : null;
}

/**
 * The step AFTER `step` in the wizard order, or null if `step` is the
 * last one (no "next" from /start/payment — that's a checkout submit).
 */
export function nextStep(step: WizardStep): WizardStep | null {
  const i = stepIndex(step);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? (WIZARD_STEPS[i + 1] ?? null) : null;
}

/**
 * URL for a given step. Always `/start/<step>`; centralised here so we
 * don't sprinkle string literals across components.
 */
export function stepPath(step: WizardStep): string {
  return `/start/${step}`;
}
