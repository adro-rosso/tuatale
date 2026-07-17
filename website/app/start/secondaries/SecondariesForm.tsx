'use client';

import { useId, useState, useTransition } from 'react';
import { submitSecondariesStep } from '@/app/start/_actions/submit-secondaries';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl, sectionCard, segTrack, segItem } from '@/components/ui/form-styles';
import { GENDERS, SUBJECT_TYPES } from '@/lib/validation/schemas';
import { PhotoUploader } from '@/app/start/child/PhotoUploader';
import type { FieldErrors } from '@/lib/validation/validate';

interface SecondaryCardData {
  name: string;
  subject_type: 'human' | 'non_human' | '';
  gender?: 'boy' | 'girl' | 'non_binary';
  relationship: string;
  appearance: string;
  extra_care: boolean;
  // Storage paths — a companion's photos drive their likeness (pet books only:
  // owner / other pets, never a child). Empty for text-only companions.
  photos: string[];
}

function emptyCard(): SecondaryCardData {
  return {
    name: '',
    subject_type: '',
    relationship: '',
    appearance: '',
    extra_care: false,
    photos: [],
  };
}

interface SecondariesFormProps {
  initialSecondaries: SecondaryCardData[];
  /** 'pet' → pet-aware copy ("who are they to {name}?"). */
  bookType: 'child' | 'pet';
  /** The hero's name, for the pet-aware "who are they to {name}?" copy. */
  protagonistName: string | null;
}

// HELD (2026-07-16): companion photo-upload ships OFF. The plumbing (PhotoUploader,
// schema `photos`, submit `photoConsent`, adapter photoPath, worker download/anchor)
// stays inert in the tree, but the UI does NOT render — pet secondaries are TEXT-ONLY,
// exactly as they are live today. A prove-by-book run showed the secondary photo-anchor
// doesn't hold the owner's likeness yet; re-enable once the secondary-likeness pipeline
// fix lands (mirror the protagonist's multi-photo/REF_AUTHORITY anchoring for secondaries).
const SECONDARY_PHOTO_ENABLED = false;

const MAX_CARDS = 3;

export function SecondariesForm({ initialSecondaries, bookType, protagonistName }: SecondariesFormProps) {
  const [cards, setCards] = useState<SecondaryCardData[]>(initialSecondaries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isPet = bookType === 'pet';
  const anyPhotos = cards.some((c) => (c.photos?.length ?? 0) > 0);

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
    setConsentError(null);
    // Companion photos need explicit consent before we use them (pet books only —
    // owner / other pets). Enforced here; the paths were already uploaded.
    if (isPet && anyPhotos && !consent) {
      setConsentError('Please confirm you’re happy for us to use these photos.');
      return;
    }
    startTransition(async () => {
      // Strip gender from non_human cards before submitting — schema's
      // refine() expects gender absent for non_human (presence triggers
      // unused-field complaints in some Zod versions). Photos ride through as-is.
      const cleaned = cards.map((c) =>
        c.subject_type === 'non_human' ? { ...c, gender: undefined } : c,
      );
      const result = await submitSecondariesStep({
        secondaries: cleaned,
        photoConsent: isPet && anyPhotos ? consent : undefined,
      });
      if (result?.errors) setErrors(result.errors);
    });
  }

  return (
    <div className="space-y-lg">
      {cards.length === 0 ? (
        <Body className="font-body text-warm-grey text-center">
          No companions added yet. Click below to add {isPet ? 'their owner, a friend, or another pet' : 'a friend, a pet, or a favourite toy'}, or skip
          this step entirely.
        </Body>
      ) : (
        <div className="space-y-md">
          {cards.map((card, idx) => (
            <SecondaryCard
              key={idx}
              data={card}
              errors={errorsForCard(errors, idx)}
              isPet={isPet}
              protagonistName={protagonistName}
              onChange={(patch) => updateCard(idx, patch)}
              onRemove={() => removeCard(idx)}
            />
          ))}
        </div>
      )}

      {isPet && anyPhotos && (
        <label className="gap-sm border-warm-grey-light/70 bg-paper p-md flex cursor-pointer items-start rounded-xl border">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="accent-iron-oxide mt-1"
          />
          <span className="font-body text-near-black text-body">
            I have the right to use these photos, and I&apos;m happy for Tuatale to use them to
            illustrate this book.
          </span>
        </label>
      )}
      {consentError && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {consentError}
        </p>
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
  isPet: boolean;
  protagonistName: string | null;
  onChange: (patch: Partial<SecondaryCardData>) => void;
  onRemove: () => void;
}

function SecondaryCard({ data, errors, isPet, protagonistName, onChange, onRemove }: SecondaryCardProps) {
  const isHuman = data.subject_type === 'human';
  const isNonHuman = data.subject_type === 'non_human';
  const uid = useId();

  return (
    <fieldset className={`${sectionCard} space-y-md`}>
      <div className="flex items-center justify-between">
        <legend className="font-heading text-near-black text-h3 not-italic">
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
          className={fieldControl}
        />
      </CardField>

      <CardField label="What sort of character?" error={errors['subject_type']}>
        <fieldset className={segTrack}>
          {SUBJECT_TYPES.map((t) => (
            <label key={t} className={segItem}>
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
          <fieldset className={segTrack}>
            {GENDERS.map((g) => (
              <label key={g} className={`${segItem} capitalize`}>
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

      <CardField
        label={isPet ? `Who are they to ${protagonistName || 'your pet'}?` : 'Who are they to your child?'}
        error={errors['relationship']}
      >
        <input
          type="text"
          value={data.relationship}
          maxLength={80}
          placeholder={isPet ? 'owner, best friend, another dog…' : 'friend, sister, dog, favourite teddy…'}
          onChange={(e) => onChange({ relationship: e.target.value })}
          className={fieldControl}
        />
      </CardField>

      <CardField label="What do they look like?" error={errors['appearance']}>
        <textarea
          value={data.appearance}
          maxLength={300}
          rows={3}
          placeholder="The more specific, the better."
          onChange={(e) => onChange({ appearance: e.target.value })}
          className={`${fieldControl} resize-y`}
        />
      </CardField>

      {/* Companion photos — HELD OFF (SECONDARY_PHOTO_ENABLED=false); secondaries are
          text-only until the secondary-likeness pipeline fix lands. */}
      {isPet && SECONDARY_PHOTO_ENABLED ? (
        <div className="space-y-xs">
          <label className="font-body text-near-black text-body block font-medium">
            Photos <span className="text-warm-grey font-normal">(optional)</span>
          </label>
          <PhotoUploader paths={data.photos} onChange={(photos) => onChange({ photos })} max={5} />
          <p className="font-body text-warm-grey text-caption">
            A clear photo or two helps us capture their true likeness. For grown-ups and pets only,
            please don&apos;t upload photos of children here.
          </p>
        </div>
      ) : null}

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
