'use client';

/**
 * The character "builder" window. Flow (style was picked in the prior step):
 *
 *   1. HERO — generate from a photo (Adro's primary path; test-wiring only).
 *   2. OR set the structured features by hand (the distinct control chips below).
 *   3. Generate → the whole-character preview mints.
 *   4. See the painted result in the (until-then empty) preview box.
 *
 * S-F teardown: the old cut-out part-hotspots are gone — meaningless once the
 * preview is a single whole-character generation.
 *
 * Photo state lives here (shared by the hero + the mint). The browser DOWNSCALES
 * the chosen image to ~640px before upload so the (PNG) payload stays well under
 * the Server-Action body limit — full-res phone photos used to silently exceed it.
 */
import { useEffect, useRef, useState } from 'react';
import { GeneratedPreview } from './GeneratedPreview';
import { PhotoHero } from './PhotoHero';
import { uploadPhoto } from '@/app/start/_actions/preview';
import {
  HAIR_COLOURS,
  SKIN_TONES,
  EYE_COLOURS,
  BUILDS,
  GLASSES_VALUES,
} from '@/lib/validation/schemas';

type Values = Record<string, string>;
const labelize = (v: string) => v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const thumbGender = (g: string) => (g === 'boy' ? 'boy' : 'girl');
const thumbSrc = (axis: string, gender: string, v: string) =>
  `/feature-thumbs/watercolor/${axis}/${thumbGender(gender)}/${v}.png`;

// Cap the longest edge before upload. 640px is ample for a face-likeness anchor
// and keeps the PNG small (the worker downloads + anchors it).
const MAX_PHOTO_DIM = 640;
function toPngBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PHOTO_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

interface AxisDef {
  key: string;
  label: string;
  kind: 'image' | 'select';
  options: readonly string[];
}

// Launch posture: the photo path is test-wiring-only, gated behind the privacy /
// safety / consent / moderation workstream (and the upload bucket is prod-gated).
// Hidden for the min-safe ship → builder-only. Flip to true to restore it for
// internal testing. (uploadPhoto + the photo state stay in the tree, just unrendered.)
const PHOTO_ENABLED = false;

interface BuilderProps {
  gender: string;
  values: Values;
  onSet: (key: string, value: string) => void;
  hairStyles: readonly string[];
  hairStyleError?: string;
  // preview meta from the form (the chips own `values`/gender)
  age: number;
  name?: string;
  freeText?: string;
  /** Optional parent-stated background/heritage — flows into the preview gen. */
  background?: string;
  /** Chosen art style — the preview mints in this style (cache-keyed per style). */
  artStyle: string;
  draftId?: string | null;
}

export function CharacterBuilder({
  gender,
  values,
  onSet,
  hairStyles,
  hairStyleError,
  age,
  name,
  freeText,
  background,
  artStyle,
  draftId,
}: BuilderProps) {
  const [open, setOpen] = useState<string | null>(null); // axis key
  const pickerRef = useRef<HTMLDivElement>(null);

  // Photo state — shared by the hero CTA and the mint (the photo path is the hero).
  const [photo, setPhoto] = useState<{ path: string; hash: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function onPhotoChosen(file: File) {
    setUploading(true);
    setPhotoError(null);
    try {
      const png = await toPngBlob(file);
      const fd = new FormData();
      fd.append('photo', png, 'photo.png');
      const { photoPath, photoHash } = await uploadPhoto(fd);
      setPhoto({ path: photoPath, hash: photoHash, name: file.name });
    } catch {
      setPhotoError('Couldn’t upload that photo. Try another.');
    } finally {
      setUploading(false);
    }
  }

  // Keep the in-place picker visible on desktop (the form is long; an anchored
  // popover can land below the fold). Harmless on mobile (fixed bottom drawer).
  useEffect(() => {
    if (open) pickerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  const axes: AxisDef[] = [
    { key: 'hair_style', label: 'Hair', kind: 'image', options: hairStyles },
    { key: 'hair_colour', label: 'Hair colour', kind: 'image', options: HAIR_COLOURS },
    { key: 'eye_colour', label: 'Eyes', kind: 'image', options: EYE_COLOURS },
    { key: 'skin_tone', label: 'Skin', kind: 'image', options: SKIN_TONES },
    { key: 'build', label: 'Build', kind: 'select', options: BUILDS },
    { key: 'glasses', label: 'Glasses', kind: 'select', options: GLASSES_VALUES },
  ];
  const axis = axes.find((a) => a.key === open);

  const pick = (key: string, v: string) => {
    onSet(key, v);
    setOpen(null);
  };

  const previewInputs = { gender, features: values, freeText, background, age, name, style: artStyle, draftId };

  return (
    <div className="space-y-lg mx-auto max-w-[34rem]">
      <style>{`
        @keyframes cb-pop { from { opacity:.3; transform: scale(.96) } to { opacity:1; transform: scale(1) } }
        .cb-pop { animation: cb-pop .26s ease-out }
        .cb-picker { position:fixed; left:0; right:0; bottom:0; max-height:62vh; overflow:auto; border-radius:18px 18px 0 0; z-index:50 }
        @media (min-width:640px){ .cb-picker { position:absolute; top:calc(100% + 8px); left:0; right:0; bottom:auto; max-height:none; border-radius:14px } }
      `}</style>

      {/* Photo path (hidden for launch — see PHOTO_ENABLED). */}
      {PHOTO_ENABLED && (
        <PhotoHero
          photo={photo}
          uploading={uploading}
          error={photoError}
          onChoose={(f) => void onPhotoChosen(f)}
          onRemove={() => setPhoto(null)}
        />
      )}

      {/* Pick their features. */}
      <div className="relative">
        {PHOTO_ENABLED && (
          <div className="gap-sm mb-sm flex items-center">
            <span className="bg-warm-grey-light h-px flex-1" />
            <span className="font-body text-warm-grey text-caption tracking-wider uppercase">
              or set their features
            </span>
            <span className="bg-warm-grey-light h-px flex-1" />
          </div>
        )}

        <div className="gap-sm flex flex-wrap justify-center">
          {axes.map((a) => {
            const v = values[a.key];
            const active = open === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => setOpen(active ? null : a.key)}
                className={`font-body text-caption px-md py-sm rounded-lg border-2 transition-colors ${
                  active
                    ? 'border-iron-oxide bg-cream-deep text-near-black'
                    : v
                      ? 'border-iron-oxide/40 bg-cream text-near-black hover:border-iron-oxide'
                      : 'border-warm-grey-light bg-cream text-near-black hover:border-iron-oxide'
                }`}
              >
                <span className="font-heading italic">{a.label}</span>
                {v ? (
                  <span className="text-warm-grey"> · {labelize(v)}</span>
                ) : (
                  <span className="text-warm-grey"> · any</span>
                )}
              </button>
            );
          })}
        </div>

        {/* In-place picker (popover desktop / drawer mobile). */}
        {open && (
          <>
            <button
              type="button"
              aria-label="Close picker"
              onClick={() => setOpen(null)}
              className="fixed inset-0 z-40 cursor-default bg-black/10 sm:bg-transparent"
            />
            <div
              ref={pickerRef}
              className="cb-pop cb-picker border-warm-grey-light bg-cream p-md mt-sm border"
              style={{ boxShadow: '0 8px 24px rgba(120,90,60,.18)' }}
            >
              {axis ? (
                <PickerPanel
                  axis={axis}
                  gender={gender}
                  value={values[axis.key] ?? ''}
                  error={axis.key === 'hair_style' ? hairStyleError : undefined}
                  onPick={(v) => pick(axis.key, v)}
                  onClose={() => setOpen(null)}
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* 3 + 4. Generate → the (until-then empty) preview box. */}
      <GeneratedPreview inputs={previewInputs} photo={photo} />

      {/* Hidden inputs carry the selections into the existing server-action form. */}
      {['hair_colour', 'hair_style', 'skin_tone', 'eye_colour', 'build', 'glasses'].map((k) => (
        <input key={k} type="hidden" name={k} value={values[k] ?? ''} />
      ))}
    </div>
  );
}

function PickerPanel({
  axis,
  gender,
  value,
  error,
  onPick,
  onClose,
}: {
  axis: AxisDef;
  gender: string;
  value: string;
  error?: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="mb-sm flex items-center justify-between">
        <span className="font-heading text-near-black text-h3 italic">{axis.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-warm-grey text-caption hover:text-iron-oxide px-xs"
        >
          Done
        </button>
      </div>
      {error && (
        <p className="font-body text-iron-oxide text-caption mb-xs" role="alert">
          {error}
        </p>
      )}
      {axis.kind === 'image' ? (
        <div className="gap-sm grid grid-cols-4 sm:grid-cols-6">
          {axis.options.map((o) => (
            <Swatch
              key={o}
              axis={axis.key}
              gender={gender}
              value={o}
              checked={value === o}
              onPick={onPick}
            />
          ))}
        </div>
      ) : (
        <div className="gap-sm flex flex-wrap">
          {axis.options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onPick(o)}
              className={`font-body text-caption px-md py-sm rounded-lg border transition-colors ${
                value === o
                  ? 'border-iron-oxide bg-cream-deep'
                  : 'border-warm-grey-light bg-cream hover:border-iron-oxide'
              }`}
            >
              {labelize(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({
  axis,
  gender,
  value,
  checked,
  onPick,
}: {
  axis: string;
  gender: string;
  value: string;
  checked: boolean;
  onPick: (v: string) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      aria-label={labelize(value)}
      aria-pressed={checked}
      className={`font-body text-near-black bg-cream p-xs gap-xs flex flex-col items-center rounded-lg border-2 text-center transition-colors ${
        checked
          ? 'border-iron-oxide ring-iron-oxide ring-2'
          : 'border-warm-grey-light hover:border-iron-oxide'
      }`}
    >
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element -- static /public thumb + onError fallback
        <img
          src={thumbSrc(axis, gender, value)}
          alt={labelize(value)}
          onError={() => setImgOk(false)}
          className="aspect-square w-full rounded object-cover"
        />
      ) : (
        <div className="bg-cream-deep text-warm-grey text-caption flex aspect-square w-full items-center justify-center rounded">
          {labelize(value)}
        </div>
      )}
      <span className="text-caption capitalize">{labelize(value)}</span>
    </button>
  );
}
