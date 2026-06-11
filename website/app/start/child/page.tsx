import { getDraft } from '@/lib/draft-fetch';
import { ChildForm } from './ChildForm';
import { featuresToFormValues } from '@/lib/child-form';

/**
 * Step 1 — about your child. Real form: name, age range, gender, an optional
 * structured "build your character" section, and a free-text additive note.
 * Pre-fills from the draft (incl. the structured features blob) so a returning
 * customer sees what they previously chose.
 */
export default async function ChildStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;

  return (
    <ChildForm
      initial={{
        name: draft?.child_name ?? '',
        age_range: draft?.age_range ?? '',
        gender: draft?.child_gender ?? '',
        appearance: draft?.child_appearance ?? '',
        ...featuresToFormValues(draft?.child_features),
      }}
    />
  );
}
