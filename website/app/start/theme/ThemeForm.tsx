'use client';

import { useActionState, useState } from 'react';
import { submitThemeStep, type SubmitThemeState } from '@/app/start/_actions/submit-theme';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { fieldControl } from '@/components/ui/form-styles';
import { THEMES, PET_THEMES, ADULT_THEMES, CUSTOM_TEMPLATE_ID, resolveStarter, type ThemeTemplate } from '@/lib/themes';
import { VIBE_OPTIONS, vibeLabel } from '@/lib/pet-vibes';
import { ADULT_VIBE_OPTIONS } from '@/lib/adult-vibes';

interface ThemeFormProps {
  initial: {
    theme: string;
    theme_template_id: string | null;
    vibe: string;
  };
  childName: string | null;
  childGender: 'boy' | 'girl' | 'non_binary' | null;
  /** 'pet' shows the story-mood (vibe) picker; the pet's name for the memorial label. */
  bookType: string;
}

const initialState: SubmitThemeState = { errors: {} };

export function ThemeForm({ initial, childName, childGender, bookType }: ThemeFormProps) {
  const [state, formAction, isPending] = useActionState(submitThemeStep, initialState);
  const [selectedId, setSelectedId] = useState(initial.theme_template_id ?? '');
  const [text, setText] = useState(initial.theme);
  // Story mood (pet + adult books). Pet default 'happy', adult default 'romantic'.
  const isPet = bookType === 'pet';
  const isAdult = bookType === 'adult';
  const showVibe = isPet || isAdult;
  const vibeOptions = isAdult ? ADULT_VIBE_OPTIONS : VIBE_OPTIONS;
  const [vibe, setVibe] = useState(initial.vibe || (isAdult ? 'romantic' : 'happy'));

  function selectTemplate(t: ThemeTemplate) {
    if (t.id === CUSTOM_TEMPLATE_ID) {
      setSelectedId(CUSTOM_TEMPLATE_ID);
      setText('');
      return;
    }
    setSelectedId(t.id);
    setText(resolveStarter(t.starter, { childName, childGender }));
  }

  // Each book type gets appropriate presets: pets get Everyday + Adventures (child
  // milestones are absurd for a pet); adults get Milestones + Everyday + Adventures;
  // child books keep Milestones + Adventures.
  const themeSet = isAdult ? ADULT_THEMES : isPet ? PET_THEMES : THEMES;
  const groups: ReadonlyArray<{ label: string; category: ThemeTemplate['category'] }> = isAdult
    ? [
        { label: 'Milestones', category: 'Milestones' },
        { label: 'Everyday', category: 'Everyday' },
        { label: 'Adventures', category: 'Adventures' },
      ]
    : isPet
      ? [
          { label: 'Everyday', category: 'Everyday' },
          { label: 'Adventures', category: 'Adventures' },
        ]
      : [
          { label: 'Milestones', category: 'Milestones' },
          { label: 'Adventures', category: 'Adventures' },
        ];

  return (
    <form action={formAction} className="space-y-lg">
      <input type="hidden" name="theme_template_id" value={selectedId} />

      {/* Story mood (pet + adult books). Sets the emotional register. For pets the
          memorial option is framed gently; for adults the vibe implies the subject. */}
      {showVibe && (
        <section className="space-y-md">
          <input type="hidden" name="vibe" value={vibe} />
          <div className="border-warm-grey-light pb-sm mb-md border-b">
            <h2 className="font-heading text-near-black text-h2 not-italic">The mood of the book</h2>
          </div>
          <div className="gap-sm tablet:grid-cols-2 grid grid-cols-1">
            {vibeOptions.map((opt) => {
              const selected = vibe === opt.value;
              // Pet 'memorial' reads "In memory of <name>"; adult labels are static.
              const label = isAdult ? opt.label : vibeLabel(opt as (typeof VIBE_OPTIONS)[number], childName);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVibe(opt.value)}
                  aria-pressed={selected}
                  className={`p-md gap-xs flex flex-col rounded-xl border-2 text-left transition-colors ${
                    selected
                      ? 'border-iron-oxide bg-cream-deep'
                      : 'border-warm-grey-light bg-paper hover:border-iron-oxide'
                  }`}
                >
                  <span className="font-heading text-near-black text-h3 not-italic">{label}</span>
                  <span className="font-body text-warm-grey text-caption">{opt.blurb}</span>
                </button>
              );
            })}
          </div>
          <Body size="caption">
            This sets the story&apos;s feeling. You can change it any time before you order.
          </Body>
        </section>
      )}

      <div className="space-y-md">
        {groups.map((g) => (
          <ThemeCategory
            key={g.label}
            label={g.label}
            templates={themeSet.filter((t) => t.category === g.category)}
            selectedId={selectedId}
            onSelect={selectTemplate}
          />
        ))}
        <button
          type="button"
          onClick={() =>
            selectTemplate({
              id: CUSTOM_TEMPLATE_ID,
              category: null,
              title: 'Write your own',
              starter: '',
            })
          }
          className={`font-heading text-h3 px-md py-md block w-full rounded-xl border-2 text-center not-italic transition-colors ${
            selectedId === CUSTOM_TEMPLATE_ID
              ? 'border-iron-oxide bg-cream-deep text-iron-oxide'
              : 'border-warm-grey-light bg-paper text-near-black hover:border-iron-oxide'
          }`}
        >
          Write your own
        </button>
      </div>

      <div className="space-y-xs">
        <label className="font-body text-near-black text-body block font-semibold">Your story</label>
        <textarea
          name="theme"
          rows={6}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's the story about? A page or two of detail is plenty."
          className={`${fieldControl} resize-y`}
        />
        {state.errors['theme'] && (
          <p className="font-body text-iron-oxide text-caption" role="alert">
            {state.errors['theme']}
          </p>
        )}
        <Body size="caption">
          You can edit anything above. Pick a template to start, or write your own from scratch.
        </Body>
      </div>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}

interface ThemeCategoryProps {
  label: string;
  templates: ReadonlyArray<ThemeTemplate>;
  selectedId: string;
  onSelect: (t: ThemeTemplate) => void;
}

function ThemeCategory({ label, templates, selectedId, onSelect }: ThemeCategoryProps) {
  return (
    <div className="space-y-sm">
      <h3 className="font-body text-warm-grey text-caption tracking-wider uppercase">{label}</h3>
      <div className="gap-sm tablet:grid-cols-2 grid grid-cols-1">
        {templates.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => onSelect(t)}
            className={`font-heading text-h3 px-md py-md block rounded-xl border-2 text-left not-italic transition-colors ${
              selectedId === t.id
                ? 'border-iron-oxide bg-cream-deep text-iron-oxide'
                : 'border-warm-grey-light bg-paper text-near-black hover:border-iron-oxide'
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>
    </div>
  );
}
