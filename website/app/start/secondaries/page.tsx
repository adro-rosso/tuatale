import { Body } from '@/components/ui/Body';

/**
 * Step 2 — friends, pets, favourite toys. Placeholder. Phase 2.C will
 * add the secondaries list builder (tier-1 text-anchored vs tier-2
 * ref-anchored, with the same conventions the pipeline already uses).
 */
export default function SecondariesStepPage() {
  return (
    <div className="text-center">
      <Body>
        This is where you’ll add a friend, a pet, or a favourite toy who’ll be part of the story.
        Optional — many books just star the child.
      </Body>
    </div>
  );
}
