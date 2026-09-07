'use client';

/**
 * Batch 4b — "Is this email wrong? Fix it" affordance on the success page.
 *
 * A quiet disclosure under the confirmation copy: a link opens a small form (new address +
 * submit) that calls correctOrderEmail, bound to this order's session id. On success it swaps
 * to a confirmation line; errors render warmly inline. The support fallback is always shown, so
 * a customer who later loses this link/cookie knows where to go (the correction needs the
 * success URL's token; support is the way back without it).
 */
import { useActionState, useState } from 'react';
import { correctOrderEmail, type CorrectEmailState } from '@/app/start/success/_actions/correct-email';
import { Body } from '@/components/ui/Body';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FieldError } from '@/components/ui/form-feedback';

const initialState: CorrectEmailState = { status: 'idle' };

export function EmailFixPanel({ sessionId, currentEmail }: { sessionId: string; currentEmail: string }) {
  const [state, formAction, isPending] = useActionState(
    correctOrderEmail.bind(null, sessionId),
    initialState,
  );
  const [open, setOpen] = useState(false);

  if (state.status === 'success') {
    return (
      <Body size="caption" className="text-warm-grey">
        Updated — we&apos;ll email you at{' '}
        <span className="text-near-black">{state.email}</span> from now on, and we&apos;ve sent a
        confirmation there.
      </Body>
    );
  }

  if (!open) {
    return (
      <Body size="caption" className="text-warm-grey">
        Wrong email?{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-iron-oxide underline underline-offset-2 hover:no-underline"
        >
          Fix it
        </button>
        .
      </Body>
    );
  }

  return (
    <form action={formAction} className="gap-sm border-warm-grey-light bg-cream-deep p-md mx-auto flex max-w-[26rem] flex-col rounded-lg border text-left">
      <label htmlFor="fix-email" className="font-body text-warm-grey text-caption tracking-wider uppercase">
        Send my order emails to
      </label>
      <Input
        id="fix-email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={currentEmail}
        aria-invalid={state.status === 'error'}
        required
      />
      {state.status === 'error' ? <FieldError>{state.message}</FieldError> : null}
      <div className="gap-sm flex items-center justify-end pt-xs">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Update email'}
        </Button>
      </div>
    </form>
  );
}
