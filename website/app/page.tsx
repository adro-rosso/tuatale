import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Heading } from '@/components/ui/Heading';
import { Body } from '@/components/ui/Body';
import { Wordmark } from '@/components/Wordmark';
import { SiteHeader } from '@/components/SiteHeader';
import { WaitlistForm } from '@/components/landing/WaitlistForm';
import { STYLE_OPTIONS, styleThumb } from '@/lib/art-style-options';

/*
 * Landing page (pre-launch).
 *
 * Honest posture: there's no fulfillment yet, so the primary action is a
 * waitlist signup ("be the first to know"), NOT a buy CTA. The hero block
 * is built so it can flip to a "Create your book → /start" CTA at launch
 * (see LAUNCH_CTA in WaitlistForm) without a redesign.
 *
 * All imagery is reused from real renders (eval-harness cover + book pages)
 * optimised into /public/landing — no generation, no external calls.
 */

const SAMPLE_PAGES = [
  { src: '/landing/showcase-leo.webp', alt: 'A boy building a treehouse with his dad, watercolour.' },
  { src: '/landing/showcase-anneliese.webp', alt: 'A girl exploring a shipwreck on the seabed, watercolour.' },
  { src: '/landing/showcase-priya.webp', alt: 'A girl and her two cats in a sunlit hallway, watercolour.' },
  { src: '/landing/showcase-bo.webp', alt: 'A toddler and his grandma in the kitchen, watercolour.' },
];

const STEPS = [
  {
    n: '1',
    title: 'Describe your child',
    body: 'Their name, their age, and as much or as little as you like. Build their look, or just tell us a few words.',
  },
  {
    n: '2',
    title: 'We craft the story and the art',
    body: 'An original tale written around them, brought to life with hand-painted watercolour illustrations.',
  },
  {
    n: '3',
    title: 'A keepsake book',
    body: 'A picture book where your child is the hero. The kind they ask you to read again and again.',
  },
];

export default function Home() {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <SiteHeader />

      {/* HERO */}
      <section className="py-2xl tablet:py-3xl">
        <Container>
          <div className="gap-2xl desktop:grid-cols-2 grid grid-cols-1 items-center">
            <div className="space-y-lg">
              <Body
                size="caption"
                className="text-warm-grey tracking-wider uppercase"
              >
                Personalised children&apos;s books
              </Body>
              <Heading level="1" italic className="text-near-black text-[40px] leading-[1.15]">
                A storybook starring your child.
              </Heading>
              <Body className="text-warm-grey max-w-[34rem]">
                Tuatale turns your child into the hero of their own picture book. An original story,
                painted by hand in soft watercolour, made for one child and no one else.
              </Body>

              <div className="pt-sm max-w-[30rem]">
                <WaitlistForm source="landing_hero" />
              </div>

              <Body size="caption" className="text-warm-grey italic">
                We&apos;re putting the finishing touches on the first books. Leave your email and
                you&apos;ll be first through the door.
              </Body>
            </div>

            {/* Hero render */}
            <div className="desktop:justify-self-end w-full">
              <div
                className="bg-cream-deep p-md rounded-2xl"
                style={{ boxShadow: '0 12px 40px rgba(120,90,60,.16)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static /public render */}
                <img
                  src="/landing/hero-cover.webp"
                  alt="A finished Tuatale book cover: Leo's Saturday Treehouse, watercolour."
                  width={1000}
                  height={773}
                  className="h-auto w-full rounded-xl"
                />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-cream-deep py-2xl tablet:py-3xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <Heading level="2" italic className="text-near-black">
              How it works
            </Heading>
            <Body className="text-warm-grey mx-auto max-w-[36rem]">
              Three small steps. We do the writing and the painting.
            </Body>
          </div>

          <div className="gap-xl tablet:grid-cols-3 grid grid-cols-1">
            {STEPS.map((step) => (
              <div key={step.n} className="space-y-sm text-center">
                <span className="font-heading text-iron-oxide border-iron-oxide/30 mx-auto flex h-12 w-12 items-center justify-center rounded-full border text-[22px] italic">
                  {step.n}
                </span>
                <Heading level="3" italic className="text-near-black">
                  {step.title}
                </Heading>
                <Body size="caption" className="text-warm-grey mx-auto max-w-[20rem]">
                  {step.body}
                </Body>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* SHOWCASE — real pages */}
      <section className="py-2xl tablet:py-3xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <Heading level="2" italic className="text-near-black">
              Real pages, painted by hand
            </Heading>
            <Body className="text-warm-grey mx-auto max-w-[36rem]">
              Every spread is original watercolour art, made for the child in the story. Here are a
              few from books we&apos;ve made.
            </Body>
          </div>

          <div className="gap-lg tablet:grid-cols-2 grid grid-cols-1">
            {SAMPLE_PAGES.map((page) => (
              <div
                key={page.src}
                className="bg-cream-deep p-sm rounded-xl"
                style={{ boxShadow: '0 6px 22px rgba(120,90,60,.12)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static /public render */}
                <img
                  src={page.src}
                  alt={page.alt}
                  width={880}
                  height={680}
                  className="h-auto w-full rounded-lg"
                />
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* SHOWCASE — art styles */}
      <section className="bg-cream-deep py-2xl tablet:py-3xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <Heading level="2" italic className="text-near-black">
              More than one way to paint a story
            </Heading>
            <Body className="text-warm-grey mx-auto max-w-[36rem]">
              We start with watercolour. More illustration styles are on the way, so the art can
              suit the child.
            </Body>
          </div>

          <div className="gap-md grid grid-cols-3 tablet:grid-cols-6">
            {STYLE_OPTIONS.map((style) => (
              <div key={style.value} className="space-y-xs text-center">
                <div className="bg-cream overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static /public thumb */}
                  <img
                    src={styleThumb(style.value)}
                    alt={`${style.label} sample`}
                    className="aspect-square h-auto w-full object-cover"
                  />
                </div>
                <Body size="caption" className="text-near-black font-heading italic">
                  {style.label}
                </Body>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* CLOSING waitlist */}
      <section className="py-2xl tablet:py-3xl">
        <Container>
          <div className="mx-auto max-w-[34rem] space-y-lg text-center">
            <Heading level="2" italic className="text-near-black">
              Be the first to make one.
            </Heading>
            <Body className="text-warm-grey">
              We&apos;ll send a single email the moment the first books are ready to order.
            </Body>
            <div className="mx-auto max-w-[30rem]">
              <WaitlistForm source="landing_footer" />
            </div>
          </div>
        </Container>
      </section>

      {/* FOOTER */}
      <footer className="border-warm-grey-light border-t">
        <Container className="py-xl">
          <div className="gap-md flex flex-col items-center justify-between text-center tablet:flex-row tablet:text-left">
            <div className="space-y-xs">
              <Wordmark size="sm" />
              <Body size="caption" className="text-warm-grey">
                A book made for one child.
              </Body>
            </div>
            <nav className="gap-lg text-caption flex items-center">
              <Link href="/privacy" className="text-warm-grey hover:text-iron-oxide">
                Privacy
              </Link>
              <Link href="/terms" className="text-warm-grey hover:text-iron-oxide">
                Terms
              </Link>
              <a href="mailto:hello@tuatale.com" className="text-warm-grey hover:text-iron-oxide">
                hello@tuatale.com
              </a>
            </nav>
          </div>
          <Body size="caption" className="text-warm-grey mt-lg text-center tablet:text-left">
            © 2026 Tuatale.
          </Body>
        </Container>
      </footer>
    </main>
  );
}
