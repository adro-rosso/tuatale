'use client';

import { useActionState, useState } from 'react';
import { submitStyleStep, type SubmitStyleState } from '@/app/start/_actions/submit-style';
import { STYLE_OPTIONS, styleThumb } from '@/lib/art-style-options';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';

interface StyleFormProps {
  /** The draft's saved art_style (or the watercolour default for a fresh draft). */
  initial: string;
}

const initialState: SubmitStyleState = { errors: {} };

/**
 * The art-style picker. A radio grid of swatches (the style-probe portraits) —
 * one selected at a time, default watercolour. The chosen value rides a hidden
 * input into the server action, which persists draft.art_style and advances to
 * the character step (where previews render in this style).
 */
export function StyleForm({ initial }: StyleFormProps) {
  const [state, formAction, isPending] = useActionState(submitStyleStep, initialState);
  const [selected, setSelected] = useState<string>(initial);
  void state; // the picker always submits a valid value; no field errors to show

  return (
    <form action={formAction} className="space-y-lg">
      <input type="hidden" name="art_style" value={selected} />

      <div className="gap-md tablet:grid-cols-3 grid grid-cols-2">
        {STYLE_OPTIONS.map((opt) => {
          const checked = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              aria-pressed={checked}
              className={`p-xs group flex flex-col rounded-xl border-2 text-left transition-colors ${
                checked
                  ? 'border-iron-oxide bg-cream-deep'
                  : 'border-warm-grey-light bg-cream hover:border-iron-oxide'
              }`}
            >
              <span
                className={`relative block aspect-square w-full overflow-hidden rounded-lg ${
                  checked ? 'ring-iron-oxide ring-2' : ''
                }`}
                style={{ backgroundColor: '#fdfbef' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static /public swatch */}
                <img
                  src={styleThumb(opt.value)}
                  alt={`${opt.label} sample`}
                  className="h-full w-full object-cover"
                />
                {/* MIN-SAFE: preview-only styles are previewable but not yet
                    purchasable (only watercolour is book-grade until W-E). */}
                {!opt.purchasable && (
                  <span className="bg-near-black/70 px-xs py-3xs absolute right-1 top-1 rounded font-body text-[10px] uppercase tracking-wide text-cream">
                    Preview only
                  </span>
                )}
              </span>
              <span className="px-xs pt-sm font-heading text-near-black text-h3 italic">
                {opt.label}
              </span>
              <span className="px-xs pb-xs font-body text-warm-grey text-caption">
                {opt.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <Body size="caption">
        Every page of the book is painted in the style you pick here. You can change it any time
        before you order. Watercolour is available to order now; the other styles are
        preview-only while we perfect them.
      </Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
