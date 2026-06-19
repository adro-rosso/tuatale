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

interface Props {
  photo: { path: string; hash: string; name: string } | null;
  uploading: boolean;
  error: string | null;
  onChoose: (file: File) => void;
  onRemove: () => void;
}

export function PhotoHero({ photo, uploading, error, onChoose, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="border-iron-oxide p-md rounded-2xl border-2"
      style={{ backgroundColor: '#fdfbef', boxShadow: '0 2px 14px rgba(120,90,60,.10)' }}
    >
      <div className="space-y-sm flex flex-col items-center text-center">
        <span className="font-heading text-near-black text-h2 italic">Start with a photo</span>
        {/* Arbitrary max-w — Tailwind v4 named scales (max-w-sm) aren't configured
            here and collapse to ~8px (the named-scale bite). Keep a readable line. */}
        <p className="font-body text-warm-grey text-caption max-w-[22rem]">
          The fastest way to a likeness. We paint your child into the story from a single photo.
        </p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="font-heading bg-iron-oxide px-lg py-md text-h3 rounded-full text-white italic transition-opacity disabled:opacity-60"
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
          <p className="font-body text-near-black text-caption">
            Using <span className="italic">{photo.name}</span> ·{' '}
            <button type="button" onClick={onRemove} className="text-iron-oxide underline">
              remove
            </button>
          </p>
        ) : null}

        {error ? (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {error}
          </p>
        ) : null}

        <p className="font-body text-warm-grey text-caption italic">
          ⚠️ Test only. Real photo upload needs the privacy &amp; safety review first.
        </p>
      </div>
    </div>
  );
}
