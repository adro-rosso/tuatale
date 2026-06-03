import { Body } from '@/components/ui/Body';

/**
 * Step 4 — see a glimpse. Placeholder. Phase 2.D lands the preview
 * generation (a single rendered page, email-gated, rate-limited) so
 * customers can see the style before paying.
 */
export default function PreviewStepPage() {
  return (
    <div className="text-center">
      <Body>
        This is where you’ll see a single rendered page from the book — a glimpse of what the
        finished story will look like. Free to view; we’ll ask for your email before generating.
      </Body>
    </div>
  );
}
