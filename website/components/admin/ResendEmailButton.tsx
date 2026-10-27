'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/Button';

/**
 * One press = one send. Disabled the instant the form submits (useFormStatus), so a second
 * click during the request can't fire a second email. The server action also claims the send
 * atomically and refuses once an email has gone out.
 */
export function ResendEmailButton({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" formAction={action} disabled={pending} aria-disabled={pending}>
      {pending ? 'Sending…' : 'Resend delivery email'}
    </Button>
  );
}
