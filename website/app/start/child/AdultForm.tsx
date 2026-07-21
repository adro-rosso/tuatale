'use client';

import { useActionState } from 'react';
import { submitAdultStep, type SubmitAdultState, type AdultFormValues } from '@/app/start/_actions/submit-adult';
import { GENDERS, ADULT_AGE_MIN, ADULT_AGE_MAX } from '@/lib/validation/schemas';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl, sectionCard, segTrack, segItem } from '@/components/ui/form-styles';

interface AdultFormProps {
  initial: {
    name: string;
    age: string;
    gender: string;
    appearance: string;
  };
}

const SELECT_CLASS = fieldControl;
const CARD = sectionCard;
const initialState: SubmitAdultState = { errors: {} };

// The stored value is the child enum (boy/girl/non_binary) — mapped to adult wording
// downstream by ADULT_AUDIENCE_OVERRIDE. The FORM shows the adult label.
const GENDER_LABEL: Record<string, string> = { boy: 'Man', girl: 'Woman', non_binary: 'Non-binary' };

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-warm-grey-light pb-sm mb-md flex items-baseline justify-between border-b">
      <h2 className="font-heading text-near-black text-h2 not-italic">{title}</h2>
      {hint ? <span className="font-body text-warm-grey text-caption tracking-wider uppercase">{hint}</span> : null}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-xs">
      <label className="font-body text-near-black text-body block font-semibold">{label}</label>
      {children}
      {error && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The adult protagonist form (book_type='adult'). Rendered by /start/child when the
 * hero step chose an adult. Text-only in Slice 1 — the photo/likeness path is Slice 2.
 *
 * Captures the adult's name, an EXPLICIT age (drives the narrated age + milestone
 * number), gender (stored as the child enum, shown with adult labels), and a free-text
 * appearance. No reading-level picker: the adult register governs prose, not a child
 * reading level.
 */
export function AdultForm({ initial }: AdultFormProps) {
  const [state, formAction, isPending] = useActionState(submitAdultStep, initialState);
  const echoed = state.values as AdultFormValues | undefined;
  const errors = state.errors;
  const fieldValue = (k: 'name' | 'age' | 'gender' | 'appearance') =>
    (echoed?.[k] as string | undefined) ?? initial[k];

  return (
    <form action={formAction} className="space-y-xl">
      <section className={CARD}>
        <SectionHead title="About them" />
        <div className="space-y-lg">
          <Field label="What's their name?" error={errors['name']}>
            <input type="text" name="name" defaultValue={fieldValue('name')} maxLength={50} className={SELECT_CLASS} autoComplete="off" />
          </Field>

          <Field label="How old are they?" error={errors['age']}>
            <input
              type="number"
              name="age"
              inputMode="numeric"
              min={ADULT_AGE_MIN}
              max={ADULT_AGE_MAX}
              defaultValue={fieldValue('age')}
              placeholder="e.g. 40"
              className={SELECT_CLASS}
              autoComplete="off"
            />
            <p className="font-body text-warm-grey text-caption mt-xs">
              Their real age — it sets how they’re written and any milestone number (a 40th, a
              retirement). Adult books are for ages {ADULT_AGE_MIN}+.
            </p>
          </Field>

          <Field label="And their gender?" error={errors['gender']}>
            <fieldset className={segTrack}>
              {GENDERS.map((g) => (
                <label key={g} className={segItem}>
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    defaultChecked={fieldValue('gender') === g}
                    className="sr-only"
                  />
                  {GENDER_LABEL[g] ?? g}
                </label>
              ))}
            </fieldset>
          </Field>

          <Field label="Describe how they look" error={errors['appearance']}>
            <textarea
              name="appearance"
              defaultValue={fieldValue('appearance')}
              rows={4}
              maxLength={500}
              placeholder="Close-cropped dark hair going grey at the temples, a short beard, round tortoiseshell glasses, a solid build. Usually in a faded olive jacket."
              className={`${SELECT_CLASS} resize-y`}
            />
            <p className="font-body text-warm-grey text-caption mt-xs">
              Hair, build, glasses, the clothes they’d be caught in — the details that make it them.
              30+ characters.
            </p>
          </Field>
        </div>
      </section>

      <Body size="caption">They’re the hero; a partner, friend, or anyone else can join as a companion on the next step.</Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
