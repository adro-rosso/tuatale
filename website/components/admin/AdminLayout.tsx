import type { ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { Container } from '@/components/ui/Container';
import { QueueTiles } from './QueueTiles';
import type { PipelineJobStatus } from '@/db/pipeline-jobs';

interface AdminLayoutProps {
  children: ReactNode;
  counts: Record<PipelineJobStatus, number>;
  adminUser: string | null;
}

/**
 * Admin chrome. Distinct from the customer-facing wizard layout:
 *
 *   - Inter throughout (no EB Garamond). This is workspace, not
 *     editorial — the brand voice lives in the customer pages.
 *   - Cream background with iron-oxide accents to stay on-brand.
 *   - Dense spacing; the queue tiles + content area aim for
 *     information density over breathing room.
 *
 * The footer is a quiet reminder of who's logged in. Logout is
 * handled by the browser (close window / clear site data) — there's
 * no in-app sign-out for a single-user HTTP-Basic-Auth setup.
 */
export function AdminLayout({ children, counts, adminUser }: AdminLayoutProps) {
  return (
    <main className="bg-cream flex min-h-screen flex-col">
      <header className="border-warm-grey-light border-b">
        <Container className="px-lg py-md gap-md flex items-center justify-between">
          <div className="gap-md flex items-baseline">
            <Wordmark size="sm" />
            <span className="font-body text-warm-grey text-caption tracking-wider uppercase">
              Admin
            </span>
          </div>
        </Container>
        <Container className="px-lg pb-md">
          <QueueTiles counts={counts} />
        </Container>
      </header>

      <section className="flex-1">
        <Container className="px-lg py-lg">{children}</Container>
      </section>

      <footer className="border-warm-grey-light border-t">
        <Container className="px-lg py-sm">
          <p className="font-body text-warm-grey text-caption">
            {adminUser
              ? `Logged in as ${adminUser}. Log out via browser settings.`
              : 'Admin user not configured — set ADMIN_USERNAME in environment.'}
          </p>
        </Container>
      </footer>
    </main>
  );
}
