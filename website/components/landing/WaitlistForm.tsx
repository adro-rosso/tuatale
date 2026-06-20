'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { joinWaitlist, type WaitlistState } from '@/app/_actions/waitlist';

/**
 * Pre-launch "be the first to know" email capture.
 *
 * NOT a buy CTA — there's no fulfillment yet, so this is an honest
 * waitlist. The layout is deliberately the same shape a real CTA will
 * take (one prominent action on a row), so when fulfillment lands this
 * whole block can be swapped for a single primary button linking to
 * /start without redesigning the hero. See `LAUNCH_CTA` below.
 */
const initialState: WaitlistState = { status: 'idle' };

// Flip to true at launch to render the "Create your book" CTA instead of
// the waitlist form. Kept here so the hero copy + button live in one place.
const LAUNCH_CTA = false;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-body bg-iron-oxide text-cream hover:bg-near-black px-lg py-md shrink-0 rounded-lg font-medium transition-colors disabled:opacity-60"
    >
      {pending ? 'Adding you…' : 'Notify me'}
    </button>
  );
}

export function WaitlistForm({ source = 'landing_hero' }: { source?: string }) {
  const [state, formAction] = useActionState(joinWaitlist, initialState);

  if (LAUNCH_CTA) {
    return (
      <a
        href="/start"
        className="font-body bg-iron-oxide text-cream hover:bg-near-black px-lg py-md inline-flex items-center justify-center rounded-lg font-medium transition-colors"
      >
        Create your book →
      </a>
    );
  }

  if (state.status === 'success') {
    return (
      <div
        className="border-warm-grey-light bg-cream-deep p-lg rounded-lg border text-center"
        role="status"
        aria-live="polite"
      >
        <p className="font-heading text-near-black text-h3 italic">You&apos;re on the list.</p>
        <p className="font-body text-warm-grey text-caption mt-xs">
          We&apos;ll email you the moment the first books are ready.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-sm w-full" noValidate>
      <div className="gap-sm flex flex-col sm:flex-row">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={state.email ?? ''}
          placeholder="you@example.com"
          aria-invalid={state.status === 'error'}
          className="font-body text-body text-near-black border-warm-grey-light bg-cream focus:border-iron-oxide px-md py-md min-w-0 flex-1 rounded-lg border focus:outline-none"
        />
        <input type="hidden" name="source" value={source} />
        <SubmitButton />
      </div>
      {state.status === 'error' && state.message ? (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="font-body text-warm-grey text-caption">
          No spam. One email when we launch, and that&apos;s it.
        </p>
      )}
    </form>
  );
}
