import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Heading } from '@/components/ui/Heading';
import { Body } from '@/components/ui/Body';
import { SiteHeader } from '@/components/SiteHeader';

/*
 * Terms stub (pre-launch). Honest placeholder — full terms land before we
 * take real orders. Linked from the landing footer so the link doesn't 404.
 */
export const metadata = { title: 'Terms — Tuatale' };

export default function TermsPage() {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <SiteHeader />
      <Container className="py-3xl space-y-lg">
        <Heading level="1" italic className="text-near-black">
          Terms
        </Heading>
        <Body className="text-warm-grey max-w-[42rem]">
          Tuatale is pre-launch. There&apos;s nothing to buy yet, so there are no purchase terms in
          force. Joining the waitlist simply means we may email you once, when the first books are
          ready to order.
        </Body>
        <Body className="text-warm-grey max-w-[42rem]">
          Full terms of service will be published here before checkout opens. Questions? Email{' '}
          <a href="mailto:hello@tuatale.com" className="text-iron-oxide hover:underline">
            hello@tuatale.com
          </a>
          .
        </Body>
        <Body size="caption">
          <Link href="/" className="text-iron-oxide hover:underline">
            ← Back home
          </Link>
        </Body>
      </Container>
    </main>
  );
}
