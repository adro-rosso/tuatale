import type { ReactNode } from 'react';
import { WizardLayout } from '@/components/wizard/WizardLayout';

/**
 * Layout for the /start/* route group. The proxy (proxy.ts at the
 * project root) has already minted a draft + set the cookie for any
 * first-time visitor before this layout renders, so by the time we
 * get here the cookie is reliably present.
 *
 * We don't currently read the draft from the DB at the layout level —
 * the chrome components (ProgressIndicator, StepHeader, WizardNav) all
 * derive what they need from useSelectedLayoutSegment. When Phase 2.C
 * starts displaying draft data in the chrome (e.g. "for Iris" in the
 * header), this is the place to fetch it and pass via React Context.
 */
export default function StartLayout({ children }: { children: ReactNode }) {
  return <WizardLayout>{children}</WizardLayout>;
}
