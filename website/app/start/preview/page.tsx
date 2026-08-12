import localFont from 'next/font/local';
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
 *
 * SELF-HOSTED (next/font/local) rather than next/font/google: the bundled .woff2 is read
 * from disk at build time, so there is NO Google Fonts network fetch — a Google Fonts
 * hiccup can't fail the build (it did, transiently, on a preview redeploy). The file is a
 * static weight-700 instance (the only weight the cover title uses) covering latin + the
 * common latin-ext accents (é, ñ, ü, …) so accented names render in Fredoka too.
 */
const fredoka = localFont({
  src: './fonts/fredoka.woff2',
  weight: '700',
  style: 'normal',
  variable: '--font-fredoka',
  display: 'swap',
});

export default function PreviewStepPage() {
  return <CoverPreview fontClassName={fredoka.variable} />;
}
