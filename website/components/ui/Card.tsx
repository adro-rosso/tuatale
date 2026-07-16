/**
 * Card primitive — a content surface that lifts off the warm cream page.
 *
 * Variants set the fill: `paper` (near-white, the default — makes art and
 * text pop), `cream` (blends into the page), `deep` (the warmer cream-deep
 * for quiet secondary panels). Every card carries the same hairline border,
 * 2xl radius, and soft shadow so surfaces read as one family. Pass padding
 * via className (cards don't assume their own inner rhythm).
 */
import type { HTMLAttributes } from 'react';

type CardVariant = 'paper' | 'cream' | 'deep';

const variantClasses: Record<CardVariant, string> = {
  paper: 'bg-paper',
  cream: 'bg-cream',
  deep: 'bg-cream-deep',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export function Card({ variant = 'paper', className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`border-warm-grey-light/70 rounded-2xl border shadow-[0_10px_36px_rgba(120,90,60,0.10)] ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
