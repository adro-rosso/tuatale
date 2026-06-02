import { Container } from '@/components/ui/Container';
import { Body } from '@/components/ui/Body';
import { Wordmark } from '@/components/Wordmark';

/*
 * Phase 1 landing page.
 *
 * No form, no flow, no checkout. Just the wordmark + a literary tagline +
 * the "coming soon" line. Centered vertically and horizontally. The page
 * exists to prove the design system + deployment work end-to-end before
 * we build the customer-facing form in Phase 2.
 *
 * The tagline is set in EB Garamond italic — same family as the wordmark
 * but not the wordmark itself (the wordmark has its own letter-spacing
 * and is uniquely recognizable).
 */
export default function Home() {
  return (
    <main className="bg-cream flex min-h-screen items-center justify-center">
      <Container className="flex flex-col items-center text-center">
        <Wordmark size="lg" />
        <p className="font-heading text-h2 text-near-black leading-heading mt-lg italic">
          A book made for one child.
        </p>
        <Body className="mt-2xl">Coming soon. Sign up to be the first to know.</Body>
      </Container>
    </main>
  );
}
