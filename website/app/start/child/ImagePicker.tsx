'use client';

import { useState } from 'react';

// Single current art style. TODO: when multiple art styles ship (post-launch),
// the active style flows in here (a new thumbnail set drops under
// public/feature-thumbs/<style>/ and this key selects it) — purely additive.
export const ACTIVE_STYLE = 'watercolor';

const labelize = (v: string) => v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

interface ImagePickerProps {
  name: string;
  label: string;
  axis: string;
  value: string;
  options: readonly string[];
  gender: string;
  error?: string;
}

/**
 * Accessible radio-grid of watercolour thumbnails — one card per value,
 * gender-matched. A real form control (sr-only radio submits via `name`,
 * keyboard/SR friendly), wraps into a mobile grid. Bases exist for boy + girl
 * only; non_binary uses the girl set (same full hair list as the dropdown).
 */
export function ImagePicker({ name, label, axis, value, options, gender, error }: ImagePickerProps) {
  const thumbGender = gender === 'boy' ? 'boy' : 'girl';
  return (
    <div className="space-y-xs">
      <label className="font-heading text-near-black text-h3 block italic">{label}</label>
      <fieldset className="gap-sm grid grid-cols-3 sm:grid-cols-4">
        {options.map((o) => (
          // key includes thumbGender so a gender flip remounts the card → its
          // image-ok state resets fresh for the new (gender-matched) src.
          <PickerCard
            key={`${o}-${thumbGender}`}
            name={name}
            value={o}
            checked={value === o}
            label={labelize(o)}
            src={`/feature-thumbs/${ACTIVE_STYLE}/${axis}/${thumbGender}/${o}.png`}
          />
        ))}
      </fieldset>
      {error && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface PickerCardProps {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  src: string;
}

// One radio card. Graceful fallback: a missing thumbnail (most, today) renders a
// clean labelled placeholder — never a broken-image icon — so the picker is fully
// functional now and auto-lights-up as assets land.
function PickerCard({ name, value, checked, label, src }: PickerCardProps) {
  // imgOk resets on gender flip via the parent's remount key (no set-state-in-effect).
  const [imgOk, setImgOk] = useState(true);

  return (
    <label className="font-body text-near-black bg-cream border-warm-grey-light hover:border-iron-oxide has-[:checked]:border-iron-oxide has-[:checked]:ring-iron-oxide gap-xs p-xs flex cursor-pointer flex-col items-center rounded border-2 text-center transition-colors has-[:checked]:ring-2">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="sr-only" />
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element -- static /public thumb + onError fallback
        <img
          src={src}
          alt={label}
          onError={() => setImgOk(false)}
          className="aspect-square w-full rounded object-cover"
        />
      ) : (
        <div className="bg-cream-deep text-warm-grey text-caption px-xs flex aspect-square w-full items-center justify-center rounded">
          {label}
        </div>
      )}
      <span className="text-caption capitalize">{label}</span>
    </label>
  );
}
