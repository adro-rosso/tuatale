// Plain TS module (no 'use server' directive). Server Action files in
// Next 16 can only export async functions; sibling helpers like
// custom error classes have to live in a separate module.

import type { WizardStep } from '@/lib/wizard-steps';
import { WIZARD_STEPS } from '@/lib/wizard-steps';

/**
 * Thrown when a navigation action is called for an impossible
 * transition (advance from payment, back from child). In normal use
 * the WizardNav component hides those buttons; this guard is defence-
 * in-depth against tampering.
 */
export class InvalidTransitionError extends Error {
  public readonly from: WizardStep;
  public readonly direction: 'advance' | 'back';

  constructor(from: WizardStep, direction: 'advance' | 'back') {
    super(
      `Invalid wizard transition: cannot ${direction} from "${from}". ` +
        `Valid steps: ${WIZARD_STEPS.join(' → ')}.`,
    );
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.direction = direction;
  }
}
