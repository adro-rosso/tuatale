'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/Button';

/**
 * Pay button with a `useFormStatus`-driven pending label.
 *
 * Lives in a thin client component so the parent payment page can
 * stay async-Server-Component shaped. The form action wiring happens
 * in the parent; we just render the submit + react to pending state.
 *
 * The pending label exists because the action's redirect to Stripe is
 * a network round-trip — without feedback the customer might click
 * twice and create two checkout sessions (Stripe deduplicates by
 * idempotency key, but the UX is still noisy).
 */
export function PayButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" disabled={pending}>
      {pending ? 'Redirecting to Stripe…' : label}
    </Button>
  );
}
