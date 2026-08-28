'use client';

/**
 * The HERO input of the character builder (Adro's call): "generate from a photo"
 * is the primary, most-prominent path. The customer can instead build features by
 * hand below.
 *
 * ⚠️ TEST-WIRING ONLY. Real child-photo upload is gated behind the banked
 * privacy / consent / content-safety workstream ([[project_photo-likeness-probe]]).
 * The flag below must stay until that review lands.
 */
import { useRef } from 'react';
import { buttonClasses } from '@/components/ui/Button';

interface Props {
  photo: { path: string; hash: string; name: string } | null;
  /** Local object URL of the uploaded image, for the confirmation thumbnail. */
  previewUrl?: string | null;
  uploading: boolean;
  /** Gate the choose button until the parent/guardian consent checkbox is ticked. */
  disabled?: boolean;
  error: string | null;
  onChoose: (file: File) => void;
  onRemove: () => void;
}

export function PhotoHero({ photo, previewUrl, uploading, disabled = false, error, onChoose, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-iron-oxide bg-paper p-md rounded-2xl border-2 shadow-[0_8px_30px_rgba(120,90,60,0.08)]">
      <div className="space-y-sm flex flex-col items-center text-center">
        <span className="font-heading text-near-black text-h2 not-italic">Start with a photo</span>
        {/* Arbitrary max-w — Tailwind v4 named scales (max-w-sm) aren't configured
            here and collapse to ~8px (the named-scale bite). Keep a readable line. */}
        <p className="font-body text-warm-grey text-caption max-w-[22rem]">
          The fastest way to a likeness. We paint your child into the story from a single photo.
        </p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled}
          className={buttonClasses('primary', 'md')}
        >
          {uploading
            ? 'Uploading…'
            : photo
              ? '📷 Choose a different photo'
              : '📷 Use a photo of your child'}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChoose(f);
            // reset so re-choosing the same file still fires onChange
            e.target.value = '';
          }}
        />

        {photo ? (
          // Clear "uploaded" confirmation: a thumbnail of the photo + a success indicator,
          // matching how the pet/companion PhotoUploader shows added photos.
          <div className="border-iron-oxide/30 bg-cream-deep p-sm gap-sm mt-xs flex w-full max-w-[22rem] items-center rounded-xl border">
            <div className="border-warm-grey-light bg-paper relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border">
              {previewUrl ? (
                // object-contain so the whole uploaded photo shows, uncropped (pet pattern).
                // eslint-disable-next-line @next/next/no-img-element -- local object-url thumbnail
                <img src={previewUrl} alt="Uploaded photo" className="h-full w-full object-contain" />
              ) : (
                <div className="text-warm-grey flex h-full w-full items-center justify-center text-2xl">📷</div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="font-body text-near-black text-caption font-semibold">✓ Photo added</p>
              <p className="font-body text-warm-grey text-caption truncate">{photo.name}</p>
              <button type="button" onClick={onRemove} className="font-body text-iron-oxide text-caption underline">
                remove
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {error}
          </p>
        ) : null}

        <p className="font-body text-warm-grey text-caption">
          ⚠️ Test only. Real photo upload needs the privacy &amp; safety review first.
        </p>
      </div>
    </div>
  );
}
