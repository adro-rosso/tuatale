'use client';

import { useActionState, useState } from 'react';
import { submitChildStep, type SubmitChildState } from '@/app/start/_actions/submit-child';
import { type ChildFormValues } from '@/lib/child-form';
import { Button } from '@/components/ui/Button';
import {
  AGE_RANGES,
  GENDERS,
  HAIR_COLOURS,
  HAIR_STYLES,
  BOY_HAIR_STYLES,
  SKIN_TONES,
  EYE_COLOURS,
  BUILDS,
  GLASSES_VALUES,
  TEE_COLOURS,
  SHORTS_COLOURS,
  SHOES,
  MARK_TYPES,
  MARK_SIDES,
} from '@/lib/validation/schemas';

interface ChildFormProps {
  initial: ChildFormValues;
}

const initialState: SubmitChildState = { errors: {} };
const SELECT_CLASS =
  'font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none';
const labelize = (v: string) => v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function ChildForm({ initial }: ChildFormProps) {
  const [state, formAction, isPending] = useActionState(submitChildStep, initialState);
  const errors = state.errors;
  const fieldValue = (k: keyof ChildFormValues): string => state.values?.[k] ?? initial[k] ?? '';

  // Gender drives the hair_style options (renderability gate: boys get the
  // restricted set). Held in client state so the dropdown filters reactively;
  // the radio stays the source of truth for the submitted value.
  const [gender, setGender] = useState<string>(fieldValue('gender'));
  const hairStyles = gender === 'boy' ? BOY_HAIR_STYLES : HAIR_STYLES;

  // Remount the whole tree when echoed values change, so every uncontrolled
  // field repopulates from its defaultValue (matches the existing pattern).
  const formKey = state.values ? `submitted:${JSON.stringify(state.values)}` : 'fresh';

  return (
    <form action={formAction} className="space-y-lg" key={formKey}>
      <Field label="What's their name?" error={errors['name']}>
        <input
          type="text"
          name="name"
          defaultValue={fieldValue('name')}
          maxLength={50}
          className={SELECT_CLASS}
          autoComplete="off"
        />
      </Field>

      <Field label="How old are they?" error={errors['age_range']}>
        <select name="age_range" defaultValue={fieldValue('age_range')} className={SELECT_CLASS}>
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
                defaultChecked={fieldValue('gender') === g}
                onChange={() => setGender(g)}
                className="sr-only"
              />
              {g.replace('_', ' ')}
            </label>
          ))}
        </fieldset>
      </Field>

      {/* ---- Optional structured "build your character" ---- */}
      <fieldset className="space-y-md border-warm-grey-light rounded border-2 border-dashed p-md">
        <legend className="font-heading text-near-black text-h3 px-sm italic">
          Build your character <span className="font-body text-warm-grey text-caption not-italic">— optional</span>
        </legend>

        <div className="gap-md grid grid-cols-1 sm:grid-cols-2">
          <Select name="hair_colour" label="Hair colour" value={fieldValue('hair_colour')} options={HAIR_COLOURS} />
          <Select
            name="hair_style"
            label="Hair style"
            value={fieldValue('hair_style')}
            options={hairStyles}
            error={errors['features.hair_style']}
          />
          <Select name="skin_tone" label="Skin tone" value={fieldValue('skin_tone')} options={SKIN_TONES} />
          <Select name="eye_colour" label="Eye colour" value={fieldValue('eye_colour')} options={EYE_COLOURS} />
          <Select name="build" label="Build" value={fieldValue('build')} options={BUILDS} />
          <Select name="glasses" label="Glasses?" value={fieldValue('glasses')} options={GLASSES_VALUES} />
        </div>

        <div className="space-y-sm">
          <p className="font-body text-near-black text-body">Outfit</p>
          <p className="font-body text-warm-grey text-caption">
            Choosing an outfit keeps it the same on every page.
          </p>
          <div className="gap-md grid grid-cols-1 sm:grid-cols-3">
            <Select name="outfit_tee" label="T-shirt" value={fieldValue('outfit_tee')} options={TEE_COLOURS} />
            <Select name="outfit_shorts" label="Shorts" value={fieldValue('outfit_shorts')} options={SHORTS_COLOURS} />
            <Select name="outfit_shoes" label="Shoes" value={fieldValue('outfit_shoes')} options={SHOES} />
          </div>
        </div>

        <div className="space-y-sm">
          <p className="font-body text-near-black text-body">A distinctive mark (optional)</p>
          <div className="gap-md grid grid-cols-1 sm:grid-cols-2">
            <Select name="mark_type" label="Type" value={fieldValue('mark_type')} options={MARK_TYPES} />
            <Select name="mark_side" label="Which cheek" value={fieldValue('mark_side')} options={MARK_SIDES} />
          </div>
        </div>
      </fieldset>

      <Field label="Anything else about them?" error={errors['appearance']}>
        <textarea
          name="appearance"
          defaultValue={fieldValue('appearance')}
          rows={4}
          maxLength={500}
          placeholder="Freckles, dimples, a favourite expression, a dress instead of shorts… anything the pickers above don't cover."
          className={`${SELECT_CLASS} resize-y`}
        />
        <p className="font-body text-warm-grey text-caption mt-xs">
          Build the character above, or just describe them here in 50+ characters — either works.
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

interface SelectProps {
  name: string;
  label: string;
  value: string;
  options: readonly string[];
  error?: string;
}

function Select({ name, label, value, options, error }: SelectProps) {
  return (
    <Field label={label} error={error}>
      <select name={name} defaultValue={value} className={SELECT_CLASS}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelize(o)}
          </option>
        ))}
      </select>
    </Field>
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
