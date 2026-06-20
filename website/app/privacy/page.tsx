import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Heading } from '@/components/ui/Heading';
import { Body } from '@/components/ui/Body';
import { SiteHeader } from '@/components/SiteHeader';

/*
 * Privacy stub (pre-launch). Honest placeholder — the full policy lands
 * before we take real orders. Linked from the landing footer so the link
 * doesn't 404.
 */
export const metadata = { title: 'Privacy — Tuatale' };

export default function PrivacyPage() {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <SiteHeader />
      <Container className="py-3xl space-y-lg">
        <Heading level="1" italic className="text-near-black">
          Privacy
        </Heading>
        <Body className="text-warm-grey max-w-[42rem]">
          Tuatale is pre-launch and not yet taking orders. Today the only thing we collect is the
          email address you give us to join the waitlist, which we use for one purpose: to tell you
          when the first books are ready. We don&apos;t sell it or share it.
        </Body>
        <Body className="text-warm-grey max-w-[42rem]">
          Our full privacy policy will be published here before we accept any orders or personal
          details about your child. Questions in the meantime? Email{' '}
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
