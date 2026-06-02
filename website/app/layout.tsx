import type { Metadata } from 'next';
import { EB_Garamond, Inter } from 'next/font/google';
import './globals.css';

/*
 * Tuatale typography — EB Garamond italic 400 for headings + wordmark,
 * Inter 400 for body. Both loaded via next/font/google so they ship
 * self-hosted (no external request to Google).
 *
 * The CSS variable names (--font-eb-garamond, --font-inter) are consumed
 * by globals.css's @theme block, which exposes them as Tailwind utilities
 * (font-heading, font-body).
 */
const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-eb-garamond',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-inter',
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
    <html lang="en" className={`${ebGaramond.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
