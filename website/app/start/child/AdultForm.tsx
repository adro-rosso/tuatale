'use client';

import { useActionState, useRef, useState } from 'react';
import { submitAdultStep, type SubmitAdultState, type AdultFormValues } from '@/app/start/_actions/submit-adult';
import { uploadAdultPhoto, removeAdultPhoto } from '@/app/start/_actions/preview';
import { GeneratedPreview } from './GeneratedPreview';
import { GENDERS, ADULT_AGE_MIN, ADULT_AGE_MAX } from '@/lib/validation/schemas';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl, sectionCard, segTrack, segItem } from '@/components/ui/form-styles';

// Slice 2: the live subject preview. The customer's own person, rendered before paying,
// so they can see the apparent age and SWAP the photo if the art reads wrong (the
// age-reconciliation loop). PHOTO_ENABLED (child) stays false — this is a distinct gate.
const ADULT_PHOTO_ENABLED = true;

// ---- CONSENT COPY (customer-facing — review gate) --------------------------
// Self-attestation. Rules out the real abuse vector (using a stranger's / non-consenting
// person's photo) WITHOUT requiring the recipient to know — it stays a surprise gift.
const CONSENT_LABEL =
  'This photo is of me or someone I know personally, and I have the right to use it for this book.';
const CONSENT_HINT =
  'We use it only to illustrate your book. You can remove it any time before you order.';

interface AdultFormProps {
  initial: {
    name: string;
    age: string;
    gender: string;
    appearance: string;
    photos: string[];
    consent: boolean;
  };
  artStyle: string;
  draftId: string | null;
}

const SELECT_CLASS = fieldControl;
const CARD = sectionCard;
const initialState: SubmitAdultState = { errors: {} };

const GENDER_LABEL: Record<string, string> = { boy: 'Man', girl: 'Woman', non_binary: 'Non-binary' };

/** Downscale any chosen image to a ≤1024px PNG in the browser before upload. */
async function toPngFile(file: File, max = 1024): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('toBlob failed');
    return new File([blob], 'adult.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="border-warm-grey-light pb-sm mb-md flex items-baseline justify-between border-b">
      <h2 className="font-heading text-near-black text-h2 not-italic">{title}</h2>
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
 * The adult protagonist form (book_type='adult'). Slice 2: adds the optional photo
 * path + inline live preview. An adult book still works text-only (Slice 1); a photo
 * (with attested consent) drives real likeness and the pre-purchase preview.
 */
export function AdultForm({ initial, artStyle, draftId }: AdultFormProps) {
  const [state, formAction, isPending] = useActionState(submitAdultStep, initialState);
  const echoed = state.values as AdultFormValues | undefined;
  const errors = state.errors;
  const fieldValue = (k: 'name' | 'age' | 'gender' | 'appearance') =>
    (echoed?.[k] as string | undefined) ?? initial[k];

  const [age, setAge] = useState<string>(fieldValue('age'));
  const [consent, setConsent] = useState<boolean>(echoed?.consent ?? initial.consent);
  const [photo, setPhoto] = useState<{ path: string; hash: string } | null>(
    (echoed?.photos ?? initial.photos)[0] ? { path: (echoed?.photos ?? initial.photos)[0]!, hash: '' } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onRemovePhoto() {
    if (!photo) return;
    setPhotoError(null);
    setRemoving(true);
    try {
      await removeAdultPhoto(photo.path); // unlinks from the draft + deletes the object
      setPhoto(null);
    } catch {
      setPhotoError('Couldn’t remove that photo. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (!consent) { setPhotoError('Please confirm the checkbox above before adding a photo.'); return; }
    setPhotoError(null);
    setUploading(true);
    try {
      const png = await toPngFile(file);
      const fd = new FormData();
      fd.append('photo', png, 'adult.png');
      const { photoPath, photoHash } = await uploadAdultPhoto(fd);
      setPhoto({ path: photoPath, hash: photoHash });
    } catch {
      setPhotoError('That photo didn’t upload. Please try another.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const ageNum = Number(age);
  const previewReady = Boolean(photo) && Number.isFinite(ageNum) && ageNum >= ADULT_AGE_MIN;

  return (
    <form action={formAction} className="space-y-xl">
      {/* Photo path carried into submit as a JSON array (mirrors pet_photos). */}
      <input type="hidden" name="adult_photos" value={JSON.stringify(photo ? [photo.path] : [])} />

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
              value={age}
              onChange={(e) => setAge(e.target.value)}
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
                  <input type="radio" name="gender" value={g} defaultChecked={fieldValue('gender') === g} className="sr-only" />
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

      {/* ---- Optional photo + live preview (Slice 2) ---- */}
      {ADULT_PHOTO_ENABLED && (
        <section className={CARD}>
          <SectionHead title="Add a photo (optional)" />
          <div className="space-y-md">
            <Body size="caption">
              A photo lets us capture their likeness and show you a preview before you order. You can
              skip it and describe them in words instead.
            </Body>

            <label className="gap-sm flex items-start">
              <input
                type="checkbox"
                name="consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1"
              />
              <span className="font-body text-near-black text-body">
                {CONSENT_LABEL}
                <span className="font-body text-warm-grey text-caption mt-xs block">{CONSENT_HINT}</span>
              </span>
            </label>
            {errors['consent'] && <p className="font-body text-iron-oxide text-caption" role="alert">{errors['consent']}</p>}

            <div className="gap-md flex items-center">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="secondary" disabled={!consent || uploading || removing} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : photo ? 'Swap photo' : 'Add a photo'}
              </Button>
              {photo && (
                <>
                  <button
                    type="button"
                    onClick={onRemovePhoto}
                    disabled={removing || uploading}
                    className="font-body text-iron-oxide text-caption underline disabled:opacity-50"
                  >
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                  <span className="font-body text-warm-grey text-caption">Photo added.</span>
                </>
              )}
            </div>
            {photoError && <p className="font-body text-iron-oxide text-caption" role="alert">{photoError}</p>}

            {previewReady && (
              <div className="pt-sm">
                <GeneratedPreview
                  inputs={{ age: ageNum, style: artStyle, isAdult: true, draftId }}
                  photo={photo}
                />
                <p className="font-body text-warm-grey text-caption mt-xs">
                  This is a preview of how they’ll look. If the age reads wrong, try a clearer or more
                  recent photo.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <Body size="caption">They’re the hero; a partner, friend, or anyone else can join as a companion on the next step.</Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending || uploading}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
