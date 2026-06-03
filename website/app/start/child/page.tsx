import { getDraft } from '@/lib/draft-fetch';
import { ChildForm } from './ChildForm';

/**
 * Step 1 — about your child. Phase 2.C: real form with four fields
 * (name, age range, gender, appearance). Pre-fills from the draft so
 * a returning customer sees what they previously typed.
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
      }}
    />
  );
}
