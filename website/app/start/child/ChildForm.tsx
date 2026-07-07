'use client';

import { useActionState, useMemo, useState } from 'react';
import { submitChildStep, type SubmitChildState } from '@/app/start/_actions/submit-child';
import { type ChildFormValues } from '@/lib/child-form';
import { ImagePicker } from './ImagePicker';
import { CharacterCanvas } from './CharacterCanvas';
import { CharacterBuilder } from './CharacterBuilder';
import { Button } from '@/components/ui/Button';
import {
  AGE_RANGES,
  GENDERS,
  HAIR_COLOURS,
  HAIR_STYLES,
  BOY_HAIR_STYLES,
  SKIN_TONES,
  EYE_COLOURS,
  BUILDS,
  GLASSES_VALUES,
  READING_LEVEL_VALUES,
  READING_LEVEL_BY_BAND,
} from '@/lib/validation/schemas';

interface ChildFormProps {
  initial: ChildFormValues;
  /** Art style chosen in the prior step — the live character preview renders in it. */
  artStyle: string;
  /** Current draft id — required for the preview cost-control attribution
   *  (requestPreview blocks a null draftId). Threaded from the child page. */
  draftId: string | null;
}

const initialState: SubmitChildState = { errors: {} };
// S0 reversibility: 'window' = the new animated click-in-place builder; 'classic' =
// the old stacked ImagePicker form. Flip here (or `git revert`) to restore classic.
const BUILDER_MODE: 'window' | 'classic' = 'window';
const SELECT_CLASS =
  'font-body text-near-black bg-cream border-warm-grey-light focus:border-iron-oxide px-md py-sm w-full rounded border-2 transition-colors outline-none';
// Shared section card — a solid, subtle bordered card (no dashed "unfinished" look),
// used for both step sections so the rhythm is consistent.
const CARD = 'border-warm-grey-light rounded-2xl border p-lg';
const labelize = (v: string) => v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
// "5-7" → 6 (the gen prompt wants a single age). Midpoint of any digits, default 7.
function ageFromRange(range: string): number {
  const nums = (range.match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return 7;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function ChildForm({ initial, artStyle, draftId }: ChildFormProps) {
  const [state, formAction, isPending] = useActionState(submitChildStep, initialState);
  const errors = state.errors;
  const fieldValue = (k: keyof ChildFormValues): string => state.values?.[k] ?? initial[k] ?? '';

  // Gender drives the hair_style options (renderability gate: boys get the
  // restricted set). Held in client state so the dropdown filters reactively;
  // the radio stays the source of truth for the submitted value.
  const [gender, setGender] = useState<string>(fieldValue('gender'));
  const hairStyles = gender === 'boy' ? BOY_HAIR_STYLES : HAIR_STYLES;

  // All visual-axis selections lifted into one state object so the window/canvas
  // react live and the values flow to the form (via hidden inputs in window mode,
  // or the radios/selects in classic mode).
  const [feat, setFeat] = useState<Record<string, string>>(() => ({
    hair_colour: fieldValue('hair_colour'),
    hair_style: fieldValue('hair_style'),
    skin_tone: fieldValue('skin_tone'),
    eye_colour: fieldValue('eye_colour'),
    build: fieldValue('build'),
    glasses: fieldValue('glasses'),
  }));
  const setFeature = (k: string, v: string) => setFeat((f) => ({ ...f, [k]: v }));

  // Lifted for the preview (the gen needs age/name/free-text). The inputs stay
  // uncontrolled (defaultValue) — these just observe for the preview request.
  const [name, setName] = useState<string>(fieldValue('name'));
  const [ageRange, setAgeRange] = useState<string>(fieldValue('age_range'));
  const [appearance, setAppearance] = useState<string>(fieldValue('appearance'));
  const [background, setBackground] = useState<string>(fieldValue('background'));
  // Reading-level OVERRIDE. '' = untouched (the card highlights the age-derived
  // default but submits '' → NULL server-side, so the book tracks the child's
  // age band). A concrete value = the parent deliberately overrode it.
  const [readingLevel, setReadingLevel] = useState<string>(fieldValue('reading_level'));

  const canvasSelections = useMemo(
    () => ({ gender, hair_colour: feat.hair_colour, hair_style: feat.hair_style, eye_colour: feat.eye_colour, glasses: feat.glasses }),
    [gender, feat.hair_colour, feat.hair_style, feat.eye_colour, feat.glasses],
  );

  // Remount the whole tree when echoed values change, so every uncontrolled
  // field repopulates from its defaultValue (matches the existing pattern).
  const formKey = state.values ? `submitted:${JSON.stringify(state.values)}` : 'fresh';

  return (
    <form action={formAction} className="space-y-xl" key={formKey}>
      {/* ---- The essentials (the only required part) ---- */}
      <section className={CARD}>
        <SectionHead title="The essentials" />
        <div className="space-y-lg">
          <Field label="What's their name?" error={errors['name']}>
            <input
              type="text"
              name="name"
              defaultValue={fieldValue('name')}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className={SELECT_CLASS}
              autoComplete="off"
            />
          </Field>

          <Field label="How old are they?" error={errors['age_range']}>
            <select name="age_range" defaultValue={fieldValue('age_range')} onChange={(e) => setAgeRange(e.target.value)} className={SELECT_CLASS}>
              <option value="">Pick an age range…</option>
              {AGE_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r} years
                </option>
              ))}
            </select>
          </Field>

          <Field label="And their gender?" error={errors['gender']}>
            <fieldset className="gap-md flex">
              {GENDERS.map((g) => (
                <label
                  key={g}
                  className="font-body text-near-black bg-cream border-warm-grey-light hover:border-iron-oxide px-md py-sm has-[:checked]:border-iron-oxide has-[:checked]:bg-cream-deep flex-1 cursor-pointer rounded border-2 text-center capitalize transition-colors"
                >
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    defaultChecked={fieldValue('gender') === g}
                    onChange={() => setGender(g)}
                    className="sr-only"
                  />
                  {g.replace('_', ' ')}
                </label>
              ))}
            </fieldset>
          </Field>
        </div>
      </section>

      {/* ---- Reading level (prose difficulty; defaults from age, overridable) ----
           Co-located right after the essentials so it sits next to age (which
           drives its default) without crowding the required fields. */}
      <section className={CARD}>
        <SectionHead title="Reading level" />
        <ReadingLevelPicker ageRange={ageRange} value={readingLevel} onChange={setReadingLevel} />
      </section>

      {/* ---- Bring them to life (every field optional) ---- */}
      <section className={CARD}>
        <SectionHead title="Bring them to life" hint="all optional" />
        <p className="font-body text-warm-grey text-body">
          Use as much or as little as you like. Build their look, add a few words, note their
          background, or skip it entirely. Anything you leave blank, we&apos;ll choose to suit the
          story.
        </p>

        <div className="space-y-lg pt-md">
          {/* Build their look */}
          <div className="space-y-sm">
            <h3 className="font-heading text-near-black text-h3 italic">Build their look</h3>
            {/* window builder (default); classic stacked pickers stay behind BUILDER_MODE
                for reversibility (flip to 'classic'; git keeps the deeper history). */}
            {BUILDER_MODE === 'window' ? (
              <CharacterBuilder
                gender={gender}
                values={feat}
                onSet={setFeature}
                hairStyles={hairStyles}
                hairStyleError={errors['features.hair_style']}
                age={ageFromRange(ageRange)}
                name={name || undefined}
                freeText={appearance || undefined}
                background={background || undefined}
                artStyle={artStyle}
                draftId={draftId}
              />
            ) : (
              <div className="space-y-md">
                <div className="bg-cream pb-sm lg:sticky lg:top-2 z-10 mx-auto max-w-[32rem]">
                  <CharacterCanvas selections={canvasSelections} />
                  <p className="font-body text-warm-grey text-caption mt-xs text-center">Live preview.</p>
                </div>
                <div className="space-y-md">
                  <ImagePicker name="hair_colour" label="Hair colour" axis="hair_colour" value={feat.hair_colour ?? ''} options={HAIR_COLOURS} gender={gender} onChange={(v) => setFeature('hair_colour', v)} />
                  <ImagePicker name="hair_style" label="Hair style" axis="hair_style" value={feat.hair_style ?? ''} options={hairStyles} gender={gender} error={errors['features.hair_style']} onChange={(v) => setFeature('hair_style', v)} />
                  <ImagePicker name="skin_tone" label="Skin tone" axis="skin_tone" value={feat.skin_tone ?? ''} options={SKIN_TONES} gender={gender} onChange={(v) => setFeature('skin_tone', v)} />
                  <ImagePicker name="eye_colour" label="Eye colour" axis="eye_colour" value={feat.eye_colour ?? ''} options={EYE_COLOURS} gender={gender} onChange={(v) => setFeature('eye_colour', v)} />
                  <div className="gap-md grid grid-cols-2">
                    <Select name="build" label="Build" value={feat.build ?? ''} options={BUILDS} onChange={(v) => setFeature('build', v)} />
                    <Select name="glasses" label="Glasses?" value={feat.glasses ?? ''} options={GLASSES_VALUES} onChange={(v) => setFeature('glasses', v)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Describe them — complements the builder */}
          <Field label="Anything else?" error={errors['appearance']}>
            <textarea
              name="appearance"
              defaultValue={fieldValue('appearance')}
              onChange={(e) => setAppearance(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Freckles, dimples, a favourite outfit, a cheeky grin."
              className={`${SELECT_CLASS} resize-y`}
            />
            <p className="font-body text-warm-grey text-caption mt-xs">
              In your own words. Add anything the builder doesn&apos;t cover, or describe them entirely here. Optional.
            </p>
          </Field>

          {/* Background / heritage */}
          <Field label="Their background" error={errors['background']}>
            <input
              name="background"
              type="text"
              defaultValue={fieldValue('background')}
              onChange={(e) => setBackground(e.target.value)}
              maxLength={120}
              placeholder="e.g. Nigerian, mixed Korean and Irish, Aboriginal Australian"
              className={SELECT_CLASS}
            />
            <p className="font-body text-warm-grey text-caption mt-xs">
              In your own words. We&apos;ll render your child faithfully and with care. Optional.
            </p>
          </Field>
        </div>
      </section>

      <div className="pt-md flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue →'}
        </Button>
      </div>
    </form>
  );
}

// Reading-level picker: 3 options, defaulted from the age band, parent-overridable.
// The highlight follows `value || derived(ageRange)`, but the SUBMITTED value
// (hidden input) is `value` alone — '' until the parent actually clicks a level.
// So an untouched picker stores NULL (worker derives from the band), and the
// highlight keeps tracking the age field; a click pins a concrete override that
// then ignores age changes. A sample page for the highlighted level shows the
// difference so the choice isn't made blind (Adro's standing requirement).
function ReadingLevelPicker({
  ageRange,
  value,
  onChange,
}: {
  ageRange: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const derived = READING_LEVEL_BY_BAND[ageRange] ?? '';
  const effective = value || derived; // highlighted level (may be '' before an age is picked)
  const sample = effective || 'standard'; // sample image fallback before an age is chosen

  return (
    <div className="space-y-md">
      {/* Carries ONLY the override; '' when untouched → NULL server-side. */}
      <input type="hidden" name="reading_level" value={value} />

      <div className="gap-md flex" role="group" aria-label="Reading level">
        {READING_LEVEL_VALUES.map((lvl) => {
          const selected = effective === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onChange(lvl)}
              aria-pressed={selected}
              className={`font-body text-near-black bg-cream px-md py-sm flex-1 cursor-pointer rounded border-2 text-center capitalize transition-colors ${
                selected ? 'border-iron-oxide bg-cream-deep' : 'border-warm-grey-light hover:border-iron-oxide'
              }`}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      <p className="font-body text-warm-grey text-caption">
        Matched to your child&apos;s age — adjust if they read above or below it.
      </p>

      <figure className="border-warm-grey-light bg-cream mx-auto max-w-[22rem] overflow-hidden rounded-xl border">
        <img
          src={`/samples/reading-level/${sample}.webp`}
          alt={`A sample ${sample} reading-level page`}
          className="block w-full"
        />
        <figcaption className="font-body text-warm-grey text-caption px-sm py-xs text-center">
          A sample page at this reading level.
        </figcaption>
      </figure>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-warm-grey-light pb-sm mb-md flex items-baseline justify-between border-b">
      <h2 className="font-heading text-near-black text-[20px] italic">{title}</h2>
      {hint ? (
        <span className="font-body text-warm-grey text-caption tracking-wider uppercase">{hint}</span>
      ) : null}
    </div>
  );
}

interface SelectProps {
  name: string;
  label: string;
  value: string;
  options: readonly string[];
  error?: string;
  onChange?: (value: string) => void;
}

function Select({ name, label, value, options, error, onChange }: SelectProps) {
  return (
    <Field label={label} error={error}>
      <select
        name={name}
        defaultValue={value}
        onChange={(e) => onChange?.(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelize(o)}
          </option>
        ))}
      </select>
    </Field>
  );
}


interface FieldProps {
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}

function Field({ label, error, children }: FieldProps) {
  return (
    <div className="space-y-xs">
      <label className="font-heading text-near-black text-h3 block italic">{label}</label>
      {children}
      {error && (
        <p className="font-body text-iron-oxide text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
