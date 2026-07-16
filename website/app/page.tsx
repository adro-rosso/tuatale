import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Body } from '@/components/ui/Body';
import { Card } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { Wordmark } from '@/components/Wordmark';
import { SiteHeader } from '@/components/SiteHeader';
import { WaitlistForm } from '@/components/landing/WaitlistForm';
import { STYLE_OPTIONS, styleThumb } from '@/lib/art-style-options';

/*
 * Landing page — a SELL page.
 *
 * Primary action is "Create your book" → /start (the wizard). The launch
 * email capture is demoted to a quiet secondary near the foot, for visitors
 * who aren't ready to start yet.
 *
 * All imagery is reused from real renders (eval-harness cover + book pages)
 * optimised into /public/landing — no generation, no external calls.
 */

const START = '/start';
const PRICE = '$79';

// The featured spread (a full real book page) + three art-forward supporting
// panels cropped to the illustration (text removed) so the row leads with art.
const FEATURED = {
  src: '/landing/showcase-leo.webp',
  alt: 'A boy building a treehouse with his dad, watercolour.',
};
const SUPPORTING = [
  { src: '/landing/showcase-anneliese-art.webp', alt: 'A girl diving down to an underwater shipwreck, watercolour.' },
  { src: '/landing/showcase-priya-art.webp', alt: 'A girl and her two cats in a sunlit doorway, watercolour.' },
  { src: '/landing/showcase-bo-art.webp', alt: 'A toddler and his grandma with an old book, watercolour.' },
];

const STEPS = [
  {
    n: '1',
    title: 'Describe your child',
    body: 'Their name, their age, and as much or as little as you like. Build their look, or just tell us a few words.',
  },
  {
    n: '2',
    title: 'We write it and paint it',
    body: 'An original tale written around them, brought to life with hand-painted illustrations in the style you choose.',
  },
  {
    n: '3',
    title: 'You approve, we print',
    body: "See the whole book before you commit. When it's perfect, we print it and ship a keepsake to your door.",
  },
];

const INCLUDED = [
  'An original story starring your child',
  'Hand-painted illustrations on every page',
  'Your choice of five art styles',
  'A full preview before anything prints',
];

export default function Home() {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <SiteHeader
        right={
          <Link href={START} className={buttonClasses('primary', 'sm')}>
            Create your book
          </Link>
        }
      />

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative overflow-hidden">
        {/* soft decorative wash so the hero fills the frame, no floating-in-void */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 55% at 78% 30%, rgba(245,229,220,0.9) 0%, rgba(251,243,238,0) 60%), radial-gradient(50% 50% at 10% 90%, rgba(107,125,94,0.10) 0%, rgba(251,243,238,0) 55%)',
          }}
        />
        <Container className="py-3xl tablet:py-4xl relative">
          <div className="gap-2xl desktop:grid-cols-[1.05fr_1fr] grid grid-cols-1 items-center">
            {/* copy */}
            <div className="space-y-lg">
              <span className="bg-cream-deep text-iron-oxide px-md py-xs text-caption inline-flex items-center rounded-full font-medium tracking-wide uppercase">
                Personalised children&apos;s books
              </span>
              <h1 className="font-heading text-near-black text-display leading-[1.03]">
                A storybook <span className="italic">starring</span> your child.
              </h1>
              <p className="font-body text-warm-grey text-lead max-w-[34rem] leading-relaxed">
                Tuatale turns your child into the hero of their own picture book — an original story,
                painted by hand, made for one child and no one else.
              </p>

              <div className="gap-md pt-xs flex flex-col items-start sm:flex-row sm:items-center">
                <Link href={START} className={buttonClasses('primary', 'lg')}>
                  Create your book →
                </Link>
                <Body size="caption" className="text-warm-grey">
                  {PRICE} · You see the whole book before it prints.
                </Body>
              </div>
            </div>

            {/* hero render */}
            <div className="desktop:justify-self-end relative w-full max-w-[36rem]">
              <Card variant="paper" className="p-md">
                {/* eslint-disable-next-line @next/next/no-img-element -- static /public render */}
                <img
                  src="/landing/hero-cover.webp"
                  alt="A finished Tuatale book cover: Leo's Saturday Treehouse."
                  width={1000}
                  height={773}
                  className="h-auto w-full rounded-xl"
                />
              </Card>
            </div>
          </div>
        </Container>
      </section>

      {/* ─────────────────────── HOW IT WORKS ─────────────────── */}
      <section className="bg-cream-deep py-3xl tablet:py-4xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <h2 className="font-heading text-near-black text-title leading-[1.1]">How it works</h2>
            <Body className="text-warm-grey text-lead mx-auto max-w-[38rem]">
              Three small steps. We do the writing and the painting.
            </Body>
          </div>

          <div className="gap-xl tablet:grid-cols-3 grid grid-cols-1">
            {STEPS.map((step) => (
              <div key={step.n} className="space-y-md flex flex-col items-center text-center">
                <span className="font-heading text-cream bg-iron-oxide text-h1 flex h-16 w-16 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(122,51,40,0.28)]">
                  {step.n}
                </span>
                <h3 className="font-heading text-near-black text-h2 not-italic">{step.title}</h3>
                <Body className="text-warm-grey mx-auto max-w-[22rem]">{step.body}</Body>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ──────────────────── SHOWCASE — the art ──────────────── */}
      <section className="bg-paper py-3xl tablet:py-4xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <h2 className="font-heading text-near-black text-title leading-[1.1]">
              Real pages, painted by hand
            </h2>
            <Body className="text-warm-grey text-lead mx-auto max-w-[40rem]">
              Every spread is original art, made for the child in the story. A few from books
              we&apos;ve made.
            </Body>
          </div>

          {/* one large featured spread — let the art dominate */}
          <Card variant="cream" className="mx-auto max-w-[62rem] overflow-hidden p-sm tablet:p-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- static /public render */}
            <img
              src={FEATURED.src}
              alt={FEATURED.alt}
              width={1600}
              height={1040}
              className="h-auto w-full rounded-xl"
            />
          </Card>

          {/* three art-forward supporting panels (illustration only, uniform squares) */}
          <div className="gap-lg mt-lg tablet:grid-cols-3 mx-auto grid max-w-[62rem] grid-cols-1">
            {SUPPORTING.map((page) => (
              <Card key={page.src} variant="cream" className="overflow-hidden p-sm">
                <div className="aspect-square overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static /public render */}
                  <img src={page.src} alt={page.alt} className="h-full w-full object-cover" />
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* ─────────────────────── STYLES ROW ───────────────────── */}
      <section className="bg-cream py-3xl tablet:py-4xl">
        <Container>
          <div className="mb-2xl space-y-sm text-center">
            <h2 className="font-heading text-near-black text-title leading-[1.1]">
              One story, your choice of style
            </h2>
            <Body className="text-warm-grey text-lead mx-auto max-w-[40rem]">
              Pick the art that suits your child — from soft watercolour to layered cut paper.
            </Body>
          </div>

          <div className="gap-md tablet:grid-cols-6 grid grid-cols-2">
            {STYLE_OPTIONS.map((style) => (
              <div
                key={style.value}
                className="border-warm-grey-light/70 bg-paper overflow-hidden rounded-2xl border"
              >
                {/* uniform frame: same bg + square crop behind every thumb, so the
                    row reads as one set regardless of each render's own margins */}
                <div className="bg-cream aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static /public thumb */}
                  <img
                    src={styleThumb(style.value)}
                    alt={`${style.label} sample`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="px-sm py-sm text-center">
                  <span className="font-heading text-near-black text-h3 not-italic">
                    {style.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ──────────────────────── PRICING ─────────────────────── */}
      <section className="bg-cream-deep py-3xl tablet:py-4xl">
        <Container>
          <Card variant="paper" className="p-xl tablet:p-2xl mx-auto max-w-[40rem] text-center">
            <h2 className="font-heading text-near-black text-title leading-[1.1]">
              One book, one price
            </h2>
            <div className="mt-md flex items-baseline justify-center gap-2">
              <span className="font-heading text-near-black text-display leading-none">{PRICE}</span>
              <span className="font-body text-warm-grey text-body">one-time</span>
            </div>
            <Body className="text-warm-grey mt-sm">
              No subscription. You only pay once, and only after you&apos;ve seen it.
            </Body>

            <ul className="gap-sm mt-xl mx-auto grid max-w-[26rem] text-left">
              {INCLUDED.map((item) => (
                <li key={item} className="gap-sm flex items-start">
                  <span aria-hidden className="text-iron-oxide mt-1 shrink-0">
                    ✓
                  </span>
                  <Body className="text-near-black">{item}</Body>
                </li>
              ))}
            </ul>

            <div className="mt-xl">
              <Link href={START} className={buttonClasses('primary', 'lg')}>
                Create your book →
              </Link>
            </div>
          </Card>
        </Container>
      </section>

      {/* ─────────── CLOSING — demoted launch-list capture ─────── */}
      <section className="bg-cream py-3xl tablet:py-4xl">
        <Container>
          <div className="mx-auto max-w-[34rem] text-center">
            <h2 className="font-heading text-near-black text-title leading-[1.1]">
              Make one tonight
            </h2>
            <Body className="text-warm-grey text-lead mt-sm">
              Start with a few words about your child. You&apos;ll see the whole book before you pay.
            </Body>
            <div className="mt-xl">
              <Link href={START} className={buttonClasses('primary', 'lg')}>
                Create your book →
              </Link>
            </div>

            {/* secondary / optional: the launch list, quietly */}
            <div className="border-warm-grey-light/70 mt-2xl border-t pt-xl">
              <Body size="caption" className="text-warm-grey mb-md">
                Not ready yet? Leave your email and we&apos;ll tell you when we add new styles and
                books.
              </Body>
              <div className="mx-auto max-w-[28rem]">
                <WaitlistForm source="landing_footer" />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ──────────────────────── FOOTER ──────────────────────── */}
      <footer className="border-warm-grey-light bg-cream border-t">
        <Container className="py-xl">
          <div className="gap-md tablet:flex-row flex flex-col items-center justify-between text-center tablet:text-left">
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
          <Body size="caption" className="text-warm-grey mt-lg tablet:text-left text-center">
            © 2026 Tuatale.
          </Body>
        </Container>
      </footer>
    </main>
  );
}
