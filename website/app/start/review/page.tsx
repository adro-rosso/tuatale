import { Body } from '@/components/ui/Body';

/**
 * Step 5 — review the details. Placeholder. Phase 2.C will surface a
 * read-only summary of everything entered so far, with Edit links back
 * to earlier steps, so the customer can verify before committing.
 */
export default function ReviewStepPage() {
  return (
    <div className="text-center">
      <Body>
        This is where you’ll see everything you’ve told us, before the story is made. You can change
        anything from here.
      </Body>
    </div>
  );
}
