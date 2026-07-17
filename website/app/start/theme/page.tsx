import { getDraft } from '@/lib/draft-fetch';
import { ThemeForm } from './ThemeForm';
import { isWizardStep } from '@/lib/wizard-steps';

const GENDERS = ['boy', 'girl', 'non_binary'] as const;
type Gender = (typeof GENDERS)[number];
function asGender(value: string | null | undefined): Gender | null {
  if (!value) return null;
  return (GENDERS as ReadonlyArray<string>).includes(value) ? (value as Gender) : null;
}

/**
 * Step 3 — pick a theme. Eight starter templates (4 Milestones,
 * 4 Adventures) plus a "Write your own" custom option. Selection
 * pre-fills the textarea with the resolved starter sentence; customer
 * can then edit freely. Both the theme text + the chosen template id
 * (if any) get persisted so the review step can show provenance.
 */
export default async function ThemeStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;

  // Silence unused-import warning while keeping isWizardStep available
  // for future cross-validation.
  void isWizardStep;

  return (
    <ThemeForm
      initial={{
        theme: draft?.theme ?? '',
        theme_template_id: draft?.theme_template_id ?? null,
        vibe: (draft as { vibe?: string | null } | null)?.vibe ?? '',
      }}
      childName={draft?.child_name ?? null}
      childGender={asGender(draft?.child_gender)}
      bookType={draft?.book_type ?? 'child'}
    />
  );
}
