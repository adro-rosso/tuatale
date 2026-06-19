'use client';

import { useActionState, useState } from 'react';
import { submitThemeStep, type SubmitThemeState } from '@/app/start/_actions/submit-theme';
import { Button } from '@/components/ui/Button';
import { Body } from '@/components/ui/Body';
import { THEMES, CUSTOM_TEMPLATE_ID, resolveStarter, type ThemeTemplate } from '@/lib/themes';

interface ThemeFormProps {
  initial: {
    theme: string;
    theme_template_id: string | null;
  };
  childName: string | null;
  childGender: 'boy' | 'girl' | 'non_binary' | null;
}

const initialState: SubmitThemeState = { errors: {} };

export function ThemeForm({ initial, childName, childGender }: ThemeFormProps) {
  const [state, formAction, isPending] = useActionState(submitThemeStep, initialState);
  const [selectedId, setSelectedId] = useState(initial.theme_template_id ?? '');
  const [text, setText] = useState(initial.theme);

  function selectTemplate(t: ThemeTemplate) {
    if (t.id === CUSTOM_TEMPLATE_ID) {
      setSelectedId(CUSTOM_TEMPLATE_ID);
      setText('');
      return;
    }
    setSelectedId(t.id);
    setText(resolveStarter(t.starter, { childName, childGender }));
  }

  const milestoneTemplates = THEMES.filter((t) => t.category === 'Milestones');
  const adventureTemplates = THEMES.filter((t) => t.category === 'Adventures');

  return (
    <form action={formAction} className="space-y-lg">
      <input type="hidden" name="theme_template_id" value={selectedId} />

      <div className="space-y-md">
        <ThemeCategory
          label="Milestones"
          templates={milestoneTemplates}
          selectedId={selectedId}
          onSelect={selectTemplate}
        />
        <ThemeCategory
          label="Adventures"
          templates={adventureTemplates}
          selectedId={selectedId}
          onSelect={selectTemplate}
        />
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
          className={`font-heading text-h3 px-md py-md block w-full rounded-lg border-2 text-center italic transition-colors ${
            selectedId === CUSTOM_TEMPLATE_ID
              ? 'border-iron-oxide bg-cream-deep text-iron-oxide'
              : 'border-warm-grey-light bg-cream text-near-black hover:border-iron-oxide'
          }`}
        >
          Write your own
        </button>
      </div>

      <div className="space-y-xs">
        <label className="font-heading text-near-black text-h3 block italic">Your story</label>
        <textarea
          name="theme"
          rows={6}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's the story about? A page or two of detail is plenty."
          className="font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full resize-y rounded border-2 transition-colors outline-none"
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
            className={`font-heading text-h3 px-md py-md block rounded-lg border-2 text-left italic transition-colors ${
              selectedId === t.id
                ? 'border-iron-oxide bg-cream-deep text-iron-oxide'
                : 'border-warm-grey-light bg-cream text-near-black hover:border-iron-oxide'
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>
    </div>
  );
}
