import { Body } from '@/components/ui/Body';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { advanceStep } from '@/app/start/_actions/navigation';

/**
 * Step 4 — see a glimpse. Placeholder for Phase 2.D, which lands the
 * preview generation (one rendered page, email-gated, rate-limited).
 *
 * The Continue button advances the draft to /start/review. Phase 2.C
 * ships this as a pass-through so the wizard flow is end-to-end
 * navigable without preview machinery in place.
 */
export default function PreviewStepPage() {
  const advance = advanceStep.bind(null, 'preview');

  return (
    <div className="space-y-lg mx-auto max-w-[40rem]">
      <Card variant="paper" className="p-xl text-center">
        <Body className="text-warm-grey">
          A glimpse of the finished book lands here in the next phase: one rendered page, free to
          view, so you can see the style before paying. For now, continue straight through.
        </Body>
      </Card>

      <form action={advance} className="flex justify-end">
        <Button type="submit" variant="primary">
          Continue →
        </Button>
      </form>
    </div>
  );
}
