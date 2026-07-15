'use client';

import { useActionState, useState } from 'react';
import { submitHeroStep, type SubmitHeroState } from '@/app/start/_actions/submit-hero';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';

interface HeroFormProps {
  /** The draft's saved book_type (or 'child' for a fresh draft). */
  initial: string;
}

const OPTIONS = [
  { value: 'child', label: 'A child', emoji: '🧒', blurb: 'Your child is the hero of their own storybook.' },
  { value: 'pet', label: 'A pet', emoji: '🐾', blurb: 'Your pet stars in the adventure, with you alongside.' },
] as const;

const initialState: SubmitHeroState = { errors: {} };

/**
 * The "who's the book about?" picker (pet-as-hero). Two cards — a child or a pet —
 * one selected at a time (default child). The choice rides a hidden input into the
 * server action, which persists draft.book_type and advances to the style step. The
 * protagonist step then renders the child or pet form to match.
 */
export function HeroForm({ initial }: HeroFormProps) {
  const [state, formAction, isPending] = useActionState(submitHeroStep, initialState);
  const [selected, setSelected] = useState<string>(initial);
  void state; // the picker always submits a valid value; no field errors to show

  return (
    <form action={formAction} className="space-y-lg">
      <input type="hidden" name="book_type" value={selected} />

      <div className="gap-md grid grid-cols-2">
        {OPTIONS.map((opt) => {
          const checked = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              aria-pressed={checked}
              className={`p-lg gap-sm flex flex-col items-center rounded-xl border-2 text-center transition-colors ${
                checked
                  ? 'border-iron-oxide bg-cream-deep'
                  : 'border-warm-grey-light bg-cream hover:border-iron-oxide'
              }`}
            >
              <span className="text-[3rem] leading-none" aria-hidden>
                {opt.emoji}
              </span>
              <span className="font-heading text-near-black text-h3 italic">{opt.label}</span>
              <span className="font-body text-warm-grey text-caption">{opt.blurb}</span>
            </button>
          );
        })}
      </div>

      <Body size="caption">You can change this any time before you order.</Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
