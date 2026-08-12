import { Fredoka } from 'next/font/google';
import { CoverPreview } from './CoverPreview';

/**
 * Step 4 — see a glimpse (Batch 4a Phase 1). Shows a PERSONALIZED COVER pre-purchase:
 * the customer's chosen character + a derived title, in their art style. Website-only —
 * it reuses the existing preview/picker generation + guards (no worker change) and is
 * gated behind COVER_PREVIEW_ENABLED (server-only, default off). When the flag is off,
 * no cover source exists, or a render fails, CoverPreview falls back to the original
 * pass-through copy — Continue is never blocked.
 *
 * Fredoka (the printed cover's title font) is loaded scoped here and threaded to the
 * client component via its CSS-variable class, so the web title matches the book cover.
 */
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

export default function PreviewStepPage() {
  return <CoverPreview fontClassName={fredoka.variable} />;
}
