import type { Metadata } from 'next';
import { Fraunces, Hanken_Grotesk } from 'next/font/google';
import './globals.css';

/*
 * Tuatale typography — "warm storybook, made confident."
 *
 * Headings = Fraunces, loaded UPRIGHT + italic (italic is a sparing accent,
 * not the default — see the Heading primitive). Body/UI = Hanken Grotesk, a
 * warm humanist sans. Both ship self-hosted via next/font/google (no external
 * request to Google).
 *
 * The CSS variable names (--font-fraunces, --font-hanken) are consumed by
 * globals.css's @theme block, which exposes them as Tailwind utilities
 * (font-heading, font-body).
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tuatale',
  description: 'A book made for one child.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`}>
      <body>{children}</body>
    </html>
  );
}
