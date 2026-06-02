/**
 * Base button primitive.
 *
 * Variants:
 *   primary   — iron oxide bg, cream text
 *   secondary — cream bg, iron oxide border + text
 *   ghost     — transparent, iron oxide text
 *
 * Sizes: sm (text-caption, py-xs px-sm), md (text-body, py-sm px-md),
 *        lg (text-body, py-md px-lg).
 *
 * Inter 500. 8px rounded corners. Subtle hover darkening.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-iron-oxide text-cream hover:bg-near-black',
  secondary: 'bg-cream text-iron-oxide border border-iron-oxide hover:bg-cream-deep',
  ghost: 'bg-transparent text-iron-oxide hover:bg-cream-deep',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-caption px-sm py-xs',
  md: 'text-body px-md py-sm',
  lg: 'text-body px-lg py-md',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`font-body inline-flex items-center justify-center rounded-lg font-medium transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
