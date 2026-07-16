/**
 * Base button primitive.
 *
 * Variants:
 *   primary   — iron oxide fill, cream text, soft lift shadow
 *   secondary — paper fill, hairline border, iron-oxide text
 *   ghost     — transparent, iron oxide text
 *
 * Sizes: sm (text-caption), md (text-body), lg (text-body, roomier).
 *
 * Hanken Grotesk 600. Rounded-xl. Tactile press (active nudge) + a
 * keyboard focus ring. The shared class recipe is exported as
 * `buttonClasses` so <Link> CTAs can look identical without nesting a
 * <button> inside an <a>.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'font-body inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iron-oxide/40 focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:pointer-events-none disabled:opacity-60';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-iron-oxide text-cream shadow-[0_2px_10px_rgba(122,51,40,0.22)] hover:bg-[#682a20] hover:shadow-[0_4px_16px_rgba(122,51,40,0.30)]',
  secondary: 'bg-paper text-iron-oxide border border-warm-grey-light hover:border-iron-oxide hover:bg-cream',
  ghost: 'bg-transparent text-iron-oxide hover:bg-cream-deep',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-caption px-md py-xs',
  md: 'text-body px-lg py-sm',
  lg: 'text-body px-xl py-md',
};

/** The composed class recipe for a button, for use on non-<button> elements
 *  (e.g. a Next <Link> CTA that must match the primary button exactly). */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return `${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
});
