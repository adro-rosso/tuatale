import { Body } from '@/components/ui/Body';

/**
 * Step 3 — choose a theme. Placeholder. Phase 2.C will surface theme
 * suggestions (a curated set of starting points like "a quiet
 * afternoon", "the day we got lost in the woods") alongside a free-text
 * field for parents who already know the story they want.
 */
export default function ThemeStepPage() {
  return (
    <div className="text-center">
      <Body>
        This is where you’ll pick what the story is about. A few suggestions to start from, or write
        your own.
      </Body>
    </div>
  );
}
