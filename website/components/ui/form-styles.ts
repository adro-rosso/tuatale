/**
 * Shared premium form-control classes for the wizard, so every step's
 * inputs, selects, textareas, segmented controls, and section cards share
 * one look — part of the Phase 2 design-system pass. Import these instead of
 * hand-rolling per-form constants.
 *
 * All spacing uses the named tokens (px-md, py-sm …) — never numeric
 * utilities, which don't resolve under this project's @theme.
 */

/** Text input / select / textarea. Paper fill, hairline border, calm focus ring. */
export const fieldControl =
  'font-body text-body text-near-black bg-paper border border-warm-grey-light rounded-xl px-md py-sm w-full transition-colors placeholder:text-warm-grey/60 focus:border-iron-oxide focus:outline-none focus:ring-2 focus:ring-iron-oxide/20';

/** A section surface inside a step — paper card that lifts off the cream page. */
export const sectionCard =
  'bg-paper border-warm-grey-light/70 p-lg rounded-2xl border shadow-[0_8px_30px_rgba(120,90,60,0.08)]';

/** Segmented-control track: a cream-deep rail holding N connected segments. */
export const segTrack = 'gap-1 bg-cream-deep p-1 flex rounded-xl';

/** A radio-driven segment (selection reflected via has-[:checked] on the label).
 *  Append `capitalize` at the call site for lowercase option values (gender etc). */
export const segItem =
  'font-body text-body text-warm-grey px-md py-sm hover:text-near-black has-[:checked]:bg-paper has-[:checked]:text-iron-oxide flex-1 cursor-pointer rounded-lg text-center font-medium transition-all has-[:checked]:shadow-[0_1px_5px_rgba(46,38,32,0.14)]';

/** A button-driven segment (selection passed explicitly as `active`). */
export function segButton(active: boolean): string {
  return `font-body text-body px-md py-sm flex-1 cursor-pointer rounded-lg text-center font-medium capitalize transition-all ${
    active
      ? 'bg-paper text-iron-oxide shadow-[0_1px_5px_rgba(46,38,32,0.14)]'
      : 'text-warm-grey hover:text-near-black'
  }`;
}
