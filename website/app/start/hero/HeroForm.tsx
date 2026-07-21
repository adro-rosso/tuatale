'use client';

import { useActionState, useState } from 'react';
import { submitHeroStep, type SubmitHeroState } from '@/app/start/_actions/submit-hero';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { Icon } from '@/components/ui/Icon';

interface HeroFormProps {
  /** The draft's saved book_type (or 'child' for a fresh draft). */
  initial: string;
}

const OPTIONS = [
  { value: 'child', label: 'A child', icon: 'child', blurb: 'Your child is the hero of their own storybook.' },
  { value: 'pet', label: 'A pet', icon: 'pet', blurb: 'Your pet stars in the adventure, with you alongside.' },
  { value: 'adult', label: 'An adult', icon: 'adult', blurb: 'A grown-up you love — a partner, a friend, the birthday one.' },
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
    <form action={formAction} className="space-y-lg mx-auto max-w-[40rem]">
      <input type="hidden" name="book_type" value={selected} />

      <div className="gap-lg grid grid-cols-1 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const checked = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              aria-pressed={checked}
              className={`p-xl gap-md group flex flex-col items-center rounded-2xl border-2 text-center transition-all ${
                checked
                  ? 'border-iron-oxide bg-cream-deep shadow-[0_10px_30px_rgba(122,51,40,0.14)]'
                  : 'border-warm-grey-light bg-paper hover:border-iron-oxide hover:-translate-y-0.5'
              }`}
            >
              <span
                className={`flex h-20 w-20 items-center justify-center rounded-full transition-colors ${
                  checked ? 'bg-iron-oxide text-cream' : 'bg-cream-deep text-iron-oxide'
                }`}
              >
                <Icon name={opt.icon} size={40} />
              </span>
              <span className="font-heading text-near-black text-h2 not-italic">{opt.label}</span>
              <span className="font-body text-warm-grey text-body">{opt.blurb}</span>
            </button>
          );
        })}
      </div>

      <Body size="caption" className="text-center">
        You can change this any time before you order.
      </Body>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" size="lg" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}
