import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

/**
 * The slim, anchored site header — a sticky cream bar with the wordmark and
 * a hairline bottom border. Single source of truth shared by the wizard
 * (WizardLayout) and the landing page so the chrome stays identical.
 *
 * `right` is an optional slot for a trailing action (e.g. a "Create your
 * book" CTA at launch). Empty on the wizard, where the progress indicator
 * carries the context.
 */
export function SiteHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-warm-grey-light bg-cream/95 sticky top-0 z-30 border-b backdrop-blur-sm">
      <div className="px-lg py-sm flex items-center justify-between">
        <Link href="/" aria-label="Tuatale home" className="inline-flex">
          <Wordmark size="sm" />
        </Link>
        {right ? <div className="flex items-center">{right}</div> : null}
      </div>
    </header>
  );
}
