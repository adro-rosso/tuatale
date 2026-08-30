'use client';

import { useId, useState, useTransition } from 'react';
import { submitSecondariesStep } from '@/app/start/_actions/submit-secondaries';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl, sectionCard, segTrack, segItem } from '@/components/ui/form-styles';
import { GENDERS, SUBJECT_TYPES } from '@/lib/validation/schemas';
import { PhotoUploader } from '@/app/start/child/PhotoUploader';
import { CharacterPicker } from '@/app/start/child/CharacterPicker';
import { uploadCompanionPhoto, removeCompanionPhoto } from '@/app/start/_actions/preview';
import { CONSENT } from '@/lib/consent/registry';
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
  /** Chosen art style — per-card picker options mint in the book's real style. */
  artStyle: string;
  /** CHARACTER_PICKER_ENABLED (server-side). OFF → no per-card picker (today's behavior). */
  pickerEnabled: boolean;
  /** CHILD_PHOTO_ENABLED (server-side, default off). ON un-gates companion photos in CHILD
   *  books behind the same consent + moderation as the protagonist. */
  childPhotoEnabled?: boolean;
}

// Companion photo-upload — PET BOOKS ONLY. Enabled 2026-07-17, once the
// secondary-likeness fix landed and was PROVEN BY BOOK (worker de29f0b): story-gen no
// longer invents a face for a photo-anchored subject, so the same photo now renders the
// real person on the pages rather than a generic stand-in.
//
// The `isPet &&` guard at the render site is LOAD-BEARING — do not remove it. This is
// deliberately NOT extended to child books: a child book's companions are frequently
// children, and a "please don't upload photos of children" note is neither consent nor
// moderation, so it discharges no obligation. Child companion photos stay behind the
// parked child-photo privacy/safety/consent workstream (the same gate as PHOTO_ENABLED).
const SECONDARY_PHOTO_ENABLED = true;

const MAX_CARDS = 3;

export function SecondariesForm({ initialSecondaries, bookType, protagonistName, artStyle, pickerEnabled, childPhotoEnabled = false }: SecondariesFormProps) {
  const [cards, setCards] = useState<SecondaryCardData[]>(initialSecondaries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isPet = bookType === 'pet';
  // Child-book companion photos: un-gated only when CHILD_PHOTO_ENABLED; they carry the
  // stricter companion-v1 consent + moderation (a child-book companion can be a child).
  const isChildCompanionPhoto = childPhotoEnabled && !isPet;
  const companionsPhotoEnabled = isPet || isChildCompanionPhoto;
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
    // Companion photos need explicit consent before we use them. Enforced here; the paths
    // were already uploaded (child-book companion uploads were also gated + moderated).
    if (companionsPhotoEnabled && anyPhotos && !consent) {
      setConsentError('Please confirm the consent checkbox before continuing.');
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
        photoConsent: companionsPhotoEnabled && anyPhotos ? consent : undefined,
        // Child-book companion photos record the versioned attestation per card (companions
        // can be children). Pet books keep the timestamp-only path (undefined version).
        photoConsentVersion: isChildCompanionPhoto && anyPhotos ? 'companion-v1' : undefined,
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
              idx={idx}
              data={card}
              errors={errorsForCard(errors, idx)}
              isPet={isPet}
              companionsPhotoEnabled={companionsPhotoEnabled}
              isChildCompanionPhoto={isChildCompanionPhoto}
              consentGiven={consent}
              protagonistName={protagonistName}
              artStyle={artStyle}
              pickerEnabled={pickerEnabled}
              onChange={(patch) => updateCard(idx, patch)}
              onRemove={() => removeCard(idx)}
            />
          ))}
        </div>
      )}

      {/* Companion-photo consent. Pet: shown once photos exist (owner/other pets). Child:
          shown as soon as a card exists, because it GATES the (child-book) companion uploads
          via `disabled` — companions can be children, so it's the stricter companion-v1
          attestation and the server stores its canonical text per card. */}
      {((isPet && anyPhotos) || (isChildCompanionPhoto && cards.length > 0)) && (
        <label className="gap-sm border-warm-grey-light/70 bg-paper p-md flex cursor-pointer items-start rounded-xl border">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="accent-iron-oxide mt-1"
          />
          <span className="font-body text-near-black text-body">
            {isChildCompanionPhoto
              ? CONSENT['companion-v1'].label
              : 'I have the right to use these photos, and I’m happy for Tuatale to use them to illustrate this book.'}
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
  idx: number;
  data: SecondaryCardData;
  errors: Record<string, string>;
  isPet: boolean;
  /** Companion photos available (pet, or child-book with CHILD_PHOTO_ENABLED). */
  companionsPhotoEnabled: boolean;
  /** Child-book companion → route through the consented + moderated upload path. */
  isChildCompanionPhoto: boolean;
  /** Form-level companion consent — gates child-book companion uploads. */
  consentGiven: boolean;
  protagonistName: string | null;
  artStyle: string;
  pickerEnabled: boolean;
  onChange: (patch: Partial<SecondaryCardData>) => void;
  onRemove: () => void;
}

function SecondaryCard({ idx, data, errors, isPet, companionsPhotoEnabled, isChildCompanionPhoto, consentGiven, protagonistName, artStyle, pickerEnabled, onChange, onRemove }: SecondaryCardProps) {
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

      {/* Companion photos. Pet books: uploadPetPhoto (no child gate). Child books
          (CHILD_PHOTO_ENABLED): routed through uploadCompanionPhoto — the SAME consent
          (companion-v1, form-level checkbox gates via `disabled`) + moderation + real
          erasure as the protagonist, because a child-book companion can be a child. */}
      {companionsPhotoEnabled && SECONDARY_PHOTO_ENABLED ? (
        <div className="space-y-xs">
          <label className="font-body text-near-black text-body block font-medium">
            Photos <span className="text-warm-grey font-normal">(optional)</span>
          </label>
          <PhotoUploader
            paths={data.photos}
            onChange={(photos) => onChange({ photos })}
            max={5}
            upload={isChildCompanionPhoto ? uploadCompanionPhoto : undefined}
            consentVersion={isChildCompanionPhoto ? 'companion-v1' : undefined}
            // Non-human companion (pet/animal/toy) → moderation drops the must-be-a-person check.
            subjectType={isChildCompanionPhoto ? data.subject_type : undefined}
            onRemovePath={isChildCompanionPhoto ? removeCompanionPhoto : undefined}
            disabled={isChildCompanionPhoto && !consentGiven}
          />
          <p className="font-body text-warm-grey text-caption">
            {isChildCompanionPhoto
              ? CONSENT['companion-v1'].hint ?? 'A clear photo or two helps us capture their true likeness.'
              : 'A clear photo or two helps us capture their true likeness. For grown-ups and pets only, please don’t upload photos of children here.'}
          </p>

          {/* Per-card character picker (flag-gated). Non-blocking — never gates Continue. */}
          {pickerEnabled && data.photos.length > 0 ? (
            <div className="pt-sm border-warm-grey-light/50 mt-sm border-t">
              <CharacterPicker
                subjectKey={`companion-${idx + 1}`}
                name={data.name || 'this character'}
                role="secondary"
                inputs={{
                  name: data.name,
                  subject_type: (data.subject_type || 'human') as 'human' | 'non_human',
                  gender: data.gender,
                  appearance: data.appearance,
                }}
                artStyle={artStyle}
                photoPaths={data.photos}
                ready={data.photos.length > 0}
              />
            </div>
          ) : null}
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
