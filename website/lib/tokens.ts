/**
 * Tuatale design tokens — single source of truth for the visual identity.
 *
 * These values are duplicated in app/globals.css's @theme block (Tailwind v4
 * reads tokens from CSS, not JS). The duplication is intentional but
 * dangerous — see tests/tokens-sync.test.ts which parses the @theme block
 * and asserts every value matches this file. Update both sides together,
 * and the test will fail loudly if you forget.
 *
 * Use this file when you need a token value in JS context (analytics tags,
 * Sentry breadcrumbs, dynamic styling, story.json-style metadata). Use the
 * Tailwind utility classes (bg-cream, text-iron-oxide, font-heading) when
 * you're styling DOM.
 *
 * Brand: Soft Heirloom palette with iron oxide.
 */
export const tokens = {
  colors: {
    cream: '#FBF3EE',
    creamDeep: '#F5E5DC',
    paper: '#FFFDF8',
    ironOxide: '#7A3328',
    sage: '#6B7D5E',
    nearBlack: '#2E2620',
    warmGrey: '#7A6F62',
    warmGreyLight: '#D9CFC2',
  },
  fonts: {
    heading: 'var(--font-fraunces)',
    body: 'var(--font-hanken)',
  },
  fontSize: {
    display: 'clamp(2.75rem, 6vw, 4.25rem)',
    title: 'clamp(1.9rem, 3vw, 2.375rem)',
    h1: '32px',
    h2: '24px',
    h3: '18px',
    lead: '20px',
    body: '16px',
    caption: '14px',
  },
  lineHeight: {
    heading: '1.25',
    body: '1.6',
  },
  letterSpacing: {
    wordmark: '0.02em',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
    '3xl': '64px',
    '4xl': '96px',
    '5xl': '128px',
  },
  breakpoints: {
    mobile: '0px',
    tablet: '768px',
    desktop: '1024px',
    wide: '1280px',
  },
} as const;

export type Tokens = typeof tokens;
