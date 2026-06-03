'use client';

import { useActionState } from 'react';
import { submitChildStep, type SubmitChildState } from '@/app/start/_actions/submit-child';
import { Button } from '@/components/ui/Button';
import { AGE_RANGES, GENDERS } from '@/lib/validation/schemas';

interface ChildFormProps {
  initial: {
    name: string;
    age_range: string;
    gender: string;
    appearance: string;
  };
}

const initialState: SubmitChildState = { errors: {} };

export function ChildForm({ initial }: ChildFormProps) {
  const [state, formAction, isPending] = useActionState(submitChildStep, initialState);
  const errors = state.errors;

  return (
    <form action={formAction} className="space-y-lg">
      <Field label="What's their name?" error={errors['name']}>
        <input
          type="text"
          name="name"
          defaultValue={initial.name}
          maxLength={50}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none"
          autoComplete="off"
        />
      </Field>

      <Field label="How old are they?" error={errors['age_range']}>
        <select
          name="age_range"
          defaultValue={initial.age_range}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none"
        >
          <option value="">Pick an age range…</option>
          {AGE_RANGES.map((r) => (
            <option key={r} value={r}>
              {r} years
            </option>
          ))}
        </select>
      </Field>

      <Field label="And their gender?" error={errors['gender']}>
        <fieldset className="gap-md flex">
          {GENDERS.map((g) => (
            <label
              key={g}
              className="font-body text-near-black bg-cream border-warm-grey-light hover:border-iron-oxide px-md py-sm has-[:checked]:border-iron-oxide has-[:checked]:bg-cream-deep flex-1 cursor-pointer rounded border-2 text-center capitalize transition-colors"
            >
              <input
                type="radio"
                name="gender"
                value={g}
                defaultChecked={initial.gender === g}
                className="sr-only"
              />
              {g.replace('_', ' ')}
            </label>
          ))}
        </fieldset>
      </Field>

      <Field label="What do they look like?" error={errors['appearance']}>
        <textarea
          name="appearance"
          defaultValue={initial.appearance}
          rows={5}
          maxLength={500}
          placeholder="Hair, eyes, what they like to wear. The more specific, the better the book."
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full resize-y rounded border-2 transition-colors outline-none"
        />
        <p className="font-body text-warm-grey text-caption mt-xs">
          We&apos;re working from your written description for now. Photo upload is coming soon.
        </p>
      </Field>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}

function Field({ label, error, children }: FieldProps) {
  return (
    <div className="space-y-xs">
      <label className="font-heading text-near-black text-h3 block italic">{label}</label>
      {children}
      {error && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
