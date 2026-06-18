import { getDraft } from '@/lib/draft-fetch';
import { ChildForm } from './ChildForm';
import { featuresToFormValues } from '@/lib/child-form';

/**
 * Step 2 — about your child. Real form: name, age range, gender, an optional
 * structured "build your character" section, and a free-text additive note.
 * Pre-fills from the draft (incl. the structured features blob) so a returning
 * customer sees what they previously chose.
 *
 * art_style (chosen in the prior /start/style step) flows in so the live
 * character preview renders in that style.
 */
export default async function ChildStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const artStyle = (draft as { art_style?: string | null } | null)?.art_style ?? 'watercolour';

  return (
    <ChildForm
      artStyle={artStyle}
      initial={{
        name: draft?.child_name ?? '',
        age_range: draft?.age_range ?? '',
        gender: draft?.child_gender ?? '',
        appearance: draft?.child_appearance ?? '',
        background: (draft as { background?: string | null } | null)?.background ?? '',
        ...featuresToFormValues(draft?.child_features),
      }}
    />
  );
}
