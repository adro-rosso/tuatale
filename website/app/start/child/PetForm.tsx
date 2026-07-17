'use client';

import { useActionState, useRef, useState } from 'react';
import { submitPetStep, type SubmitPetState, type PetFormValues } from '@/app/start/_actions/submit-pet';
import { uploadPetPhoto } from '@/app/start/_actions/preview';
import { READING_LEVEL_VALUES } from '@/lib/validation/schemas';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl, sectionCard, segTrack, segButton } from '@/components/ui/form-styles';

interface PetFormProps {
  initial: {
    name: string;
    reading_level: string;
    animal_kind: string;
    appearance: string;
    photos: string[];
  };
}

const SELECT_CLASS = fieldControl;
const CARD = sectionCard;
const MAX_PHOTOS = 5;

const initialState: SubmitPetState = { errors: {} };

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
    return new File([blob], 'pet.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
 * The pet protagonist form (book_type='pet'). Rendered by /start/child when the hero
 * step chose a pet. Captures the pet's name, kind, coat/markings, the reader's age
 * band, and — critically — several photos of the SAME pet (their likeness comes from
 * the photos; text alone renders a generic breed). Persists onto the draft.
 */
export function PetForm({ initial }: PetFormProps) {
  const [state, formAction, isPending] = useActionState(submitPetStep, initialState);
  const echoed = state.values as PetFormValues | undefined;
  const errors = state.errors;
  const fileRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<Array<{ path: string; previewUrl?: string }>>(
    (echoed?.photos ?? initial.photos).map((p) => ({ path: p })),
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Reading level is a DIRECT pick for pets (a pet book's reader can be a child or
  // an adult owner), default standard — no age question. See submit-pet (age_range
  // is derived from this to keep the downstream columns populated).
  const [readingLevel, setReadingLevel] = useState<string>(
    (echoed?.reading_level as string | undefined) || initial.reading_level || 'standard',
  );

  const fieldValue = (k: 'name' | 'animal_kind' | 'appearance') =>
    (echoed?.[k] as string | undefined) ?? initial[k];

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      const room = MAX_PHOTOS - photos.length;
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const png = await toPngFile(file);
        const fd = new FormData();
        fd.append('photo', png);
        const { photoPath } = await uploadPetPhoto(fd);
        const previewUrl = URL.createObjectURL(png);
        setPhotos((prev) => (prev.length < MAX_PHOTOS ? [...prev, { path: photoPath, previewUrl }] : prev));
      }
    } catch {
      setUploadError('That photo didn’t upload. Please try another.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const removePhoto = (path: string) => setPhotos((prev) => prev.filter((p) => p.path !== path));

  return (
    <form action={formAction} className="space-y-xl">
      <input type="hidden" name="pet_photos" value={JSON.stringify(photos.map((p) => p.path))} />

      {/* ---- The essentials ---- */}
      <section className={CARD}>
        <SectionHead title="About your pet" />
        <div className="space-y-lg">
          <Field label="What's your pet's name?" error={errors['name']}>
            <input type="text" name="name" defaultValue={fieldValue('name')} maxLength={50} className={SELECT_CLASS} autoComplete="off" />
          </Field>

          <Field label="What kind of animal are they?" error={errors['animal_kind']}>
            <input
              type="text"
              name="animal_kind"
              defaultValue={fieldValue('animal_kind')}
              maxLength={40}
              placeholder="Golden retriever, tabby cat, lop-eared rabbit…"
              className={SELECT_CLASS}
              autoComplete="off"
            />
          </Field>

          <Field label="Describe their coat and markings" error={errors['appearance']}>
            <textarea
              name="appearance"
              defaultValue={fieldValue('appearance')}
              rows={4}
              maxLength={500}
              placeholder="A rich chocolate-brown wavy coat, a tan beard, floppy ears, and a curled tail."
              className={`${SELECT_CLASS} resize-y`}
            />
            <p className="font-body text-warm-grey text-caption mt-xs">
              Colour and any distinctive markings help us keep their true look. 30+ characters.
            </p>
          </Field>
        </div>
      </section>

      {/* ---- Reading level (direct pick; a pet book's reader can be any age) ---- */}
      <section className={CARD}>
        <SectionHead title="Reading level" />
        <input type="hidden" name="reading_level" value={readingLevel} />
        <div className="space-y-md">
          <div className={segTrack} role="group" aria-label="Reading level">
            {READING_LEVEL_VALUES.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setReadingLevel(lvl)}
                aria-pressed={readingLevel === lvl}
                className={segButton(readingLevel === lvl)}
              >
                {lvl}
              </button>
            ))}
          </div>
          <p className="font-body text-warm-grey text-caption">
            How simple or rich the words are. Pick for whoever will read it — a little one, or the
            grown-up who loves them.
          </p>
          <figure className="border-warm-grey-light bg-paper mx-auto max-w-[22rem] overflow-hidden rounded-xl border shadow-[0_8px_30px_rgba(120,90,60,0.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- static /public sample */}
            <img
              src={`/samples/reading-level/${readingLevel}.webp`}
              alt={`A sample ${readingLevel} reading-level page`}
              className="block w-full"
            />
            <figcaption className="font-body text-warm-grey text-caption px-sm py-xs text-center">
              A sample page at this reading level.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ---- Photos (required — the likeness comes from these) ---- */}
      <section className={CARD}>
        <SectionHead title="Photos of your pet" hint="the more the better" />
        <p className="font-body text-warm-grey text-body">
          Add a few clear photos of <strong>the same pet</strong> from different angles — a face-on shot, a full-body
          shot, and their coat. This is how we capture <em>your</em> pet, not a generic one.
        </p>

        <div className="gap-sm pt-md grid grid-cols-3 sm:grid-cols-5">
          {photos.map((p) => (
            <div key={p.path} className="border-warm-grey-light relative aspect-square overflow-hidden rounded-lg border">
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object-url thumbnail
                <img src={p.previewUrl} alt="Pet photo" className="h-full w-full object-cover" />
              ) : (
                <div className="bg-cream-deep font-body text-warm-grey text-caption flex h-full w-full items-center justify-center">Saved</div>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p.path)}
                className="bg-near-black/70 absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-cream"
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="border-warm-grey-light hover:border-iron-oxide font-body text-warm-grey text-caption flex aspect-square items-center justify-center rounded-lg border-2 border-dashed transition-colors"
            >
              {uploading ? 'Uploading…' : '+ Add'}
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />

        {(uploadError || errors['photos']) && (
          <p className="font-body text-iron-oxide text-caption pt-sm" role="alert">
            {uploadError ?? errors['photos']}
          </p>
        )}

        <label className="gap-sm pt-md flex cursor-pointer items-start">
          <input type="checkbox" name="consent" defaultChecked={echoed?.consent} className="mt-1" />
          <span className="font-body text-near-black text-body">
            I have the right to use these photos, and I&apos;m happy for Tuatale to use them to illustrate this book.
          </span>
        </label>
        {errors['consent'] && (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {errors['consent']}
          </p>
        )}
      </section>

      <Body size="caption">Your pet is the hero; you (or anyone else) can join as a companion on the next step.</Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending || uploading}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
