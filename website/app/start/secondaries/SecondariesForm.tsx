'use client';

import { useId, useState, useTransition } from 'react';
import { submitSecondariesStep } from '@/app/start/_actions/submit-secondaries';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { GENDERS, SUBJECT_TYPES } from '@/lib/validation/schemas';
import type { FieldErrors } from '@/lib/validation/validate';

interface SecondaryCardData {
  name: string;
  subject_type: 'human' | 'non_human' | '';
  gender?: 'boy' | 'girl' | 'non_binary';
  relationship: string;
  appearance: string;
  extra_care: boolean;
}

function emptyCard(): SecondaryCardData {
  return {
    name: '',
    subject_type: '',
    relationship: '',
    appearance: '',
    extra_care: false,
  };
}

interface SecondariesFormProps {
  initialSecondaries: SecondaryCardData[];
}

const MAX_CARDS = 3;

export function SecondariesForm({ initialSecondaries }: SecondariesFormProps) {
  const [cards, setCards] = useState<SecondaryCardData[]>(initialSecondaries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isPending, startTransition] = useTransition();

  function updateCard(idx: number, patch: Partial<SecondaryCardData>) {
    setCards(cards.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeCard(idx: number) {
    setCards(cards.filter((_, i) => i !== idx));
  }
  function addCard() {
    if (cards.length >= MAX_CARDS) return;
    setCards([...cards, emptyCard()]);
  }
  function handleSubmit() {
    setErrors({});
    startTransition(async () => {
      // Strip gender from non_human cards before submitting — schema's
      // refine() expects gender absent for non_human (presence triggers
      // unused-field complaints in some Zod versions).
      const cleaned = cards.map((c) =>
        c.subject_type === 'non_human' ? { ...c, gender: undefined } : c,
      );
      const result = await submitSecondariesStep({ secondaries: cleaned });
      if (result?.errors) setErrors(result.errors);
    });
  }

  return (
    <div className="space-y-lg">
      {cards.length === 0 ? (
        <Body className="font-body text-warm-grey text-center">
          No companions added yet. Click below to add a friend, a pet, or a favourite toy — or skip
          this step entirely.
        </Body>
      ) : (
        <div className="space-y-md">
          {cards.map((card, idx) => (
            <SecondaryCard
              key={idx}
              data={card}
              errors={errorsForCard(errors, idx)}
              onChange={(patch) => updateCard(idx, patch)}
              onRemove={() => removeCard(idx)}
            />
          ))}
        </div>
      )}

      <div className="gap-md tablet:flex-row tablet:items-center tablet:justify-between flex flex-col">
        <Button
          variant="secondary"
          type="button"
          onClick={addCard}
          disabled={cards.length >= MAX_CARDS}
        >
          {cards.length >= MAX_CARDS ? 'Three is the limit for now.' : 'Add another character'}
        </Button>
        <Button variant="primary" type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </div>
  );
}

function errorsForCard(all: FieldErrors, idx: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, msg] of Object.entries(all)) {
    const m = path.match(/^(\d+)\.(.+)$/);
    if (m && Number(m[1]) === idx && m[2]) {
      out[m[2]] = msg;
    }
  }
  return out;
}

interface SecondaryCardProps {
  data: SecondaryCardData;
  errors: Record<string, string>;
  onChange: (patch: Partial<SecondaryCardData>) => void;
  onRemove: () => void;
}

function SecondaryCard({ data, errors, onChange, onRemove }: SecondaryCardProps) {
  const isHuman = data.subject_type === 'human';
  const isNonHuman = data.subject_type === 'non_human';
  const uid = useId();

  return (
    <fieldset className="border-warm-grey-light bg-cream p-lg space-y-md rounded-lg border">
      <div className="flex items-center justify-between">
        <legend className="font-heading text-near-black text-h3 italic">
          {data.name || 'New character'}
        </legend>
        <Button variant="ghost" type="button" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <CardField label="Their name" error={errors['name']}>
        <input
          type="text"
          value={data.name}
          maxLength={50}
          onChange={(e) => onChange({ name: e.target.value })}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none"
        />
      </CardField>

      <CardField label="What sort of character?" error={errors['subject_type']}>
        <fieldset className="gap-sm flex">
          {SUBJECT_TYPES.map((t) => (
            <label
              key={t}
              className="font-body text-near-black bg-cream border-warm-grey-light px-md py-sm has-[:checked]:border-iron-oxide has-[:checked]:bg-cream-deep flex-1 cursor-pointer rounded border-2 text-center transition-colors"
            >
              <input
                type="radio"
                name={`subject_type_${uid}`}
                value={t}
                checked={data.subject_type === t}
                onChange={() => onChange({ subject_type: t })}
                className="sr-only"
              />
              {t === 'human' ? 'A person' : 'An animal or toy'}
            </label>
          ))}
        </fieldset>
      </CardField>

      {isHuman ? (
        <CardField label="Their gender" error={errors['gender']}>
          <fieldset className="gap-sm flex">
            {GENDERS.map((g) => (
              <label
                key={g}
                className="font-body text-near-black bg-cream border-warm-grey-light px-md py-sm has-[:checked]:border-iron-oxide has-[:checked]:bg-cream-deep flex-1 cursor-pointer rounded border-2 text-center capitalize transition-colors"
              >
                <input
                  type="radio"
                  name={`gender_${uid}`}
                  value={g}
                  checked={data.gender === g}
                  onChange={() => onChange({ gender: g })}
                  className="sr-only"
                />
                {g.replace('_', ' ')}
              </label>
            ))}
          </fieldset>
        </CardField>
      ) : null}

      <CardField label="Who are they to your child?" error={errors['relationship']}>
        <input
          type="text"
          value={data.relationship}
          maxLength={80}
          placeholder="friend, sister, dog, favourite teddy…"
          onChange={(e) => onChange({ relationship: e.target.value })}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none"
        />
      </CardField>

      <CardField label="What do they look like?" error={errors['appearance']}>
        <textarea
          value={data.appearance}
          maxLength={300}
          rows={3}
          placeholder="The more specific, the better."
          onChange={(e) => onChange({ appearance: e.target.value })}
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full resize-y rounded border-2 transition-colors outline-none"
        />
      </CardField>

      {isNonHuman ? (
        <label className="gap-sm flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={data.extra_care}
            onChange={(e) => onChange({ extra_care: e.target.checked })}
            className="accent-iron-oxide"
          />
          <span className="font-body text-near-black text-body">Render with extra care</span>
        </label>
      ) : null}
      {isNonHuman && (
        <p className="font-body text-warm-grey text-caption">
          Use this for animals or toys with unusual markings or features you really want captured.
          Adds $10.
        </p>
      )}
    </fieldset>
  );
}

function CardField({
  label,
  error,
  children,
}: {
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-xs">
      <label className="font-body text-near-black text-body block font-medium">{label}</label>
      {children}
      {error && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
