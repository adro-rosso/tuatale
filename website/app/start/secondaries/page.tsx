import { getDraft } from '@/lib/draft-fetch';
import { SecondariesForm } from './SecondariesForm';
import { Body } from '@/components/ui/Body';

/**
 * Step 2 — friends, pets, favourite toys. Up to three companions per
 * book. Optional step — skipping (zero secondaries) is valid input.
 */
export default async function SecondariesStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;

  // The draft's `secondaries` column is jsonb (typed as Json). We put
  // a shaped array in via the server action, so casting back to the
  // SecondaryCardData[] shape is safe in practice. Guard with
  // Array.isArray so a malformed value doesn't crash the form.
  const initial = Array.isArray(draft?.secondaries)
    ? (
        draft.secondaries as Array<{
          name?: string;
          subject_type?: 'human' | 'non_human' | '';
          gender?: 'boy' | 'girl' | 'non_binary';
          relationship?: string;
          appearance?: string;
          extra_care?: boolean;
        }>
      ).map((s) => ({
        name: s.name ?? '',
        subject_type: (s.subject_type ?? '') as 'human' | 'non_human' | '',
        gender: s.gender,
        relationship: s.relationship ?? '',
        appearance: s.appearance ?? '',
        extra_care: s.extra_care ?? false,
      }))
    : [];

  return (
    <div className="space-y-lg">
      <Body className="text-center">
        Add up to three companions: a friend, a pet, a favourite toy. You can skip this if
        you&apos;d rather just tell {draft?.child_name ?? 'their'} own story.
      </Body>
      <SecondariesForm initialSecondaries={initial} />
    </div>
  );
}
