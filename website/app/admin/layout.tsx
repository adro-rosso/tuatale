import type { ReactNode } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { countJobsByStatus } from '@/db/pipeline-jobs';
import { adminUsername } from '@/lib/admin-auth';

/**
 * Layout for the /admin route group.
 *
 * Fetches the queue summary counts server-side so every admin page
 * — list, detail, anything Cycle A.5+ adds — shares the same
 * up-to-date tiles. Pages call `revalidatePath('/admin', 'layout')`
 * after each status transition so the tiles re-render.
 *
 * The proxy already auth-gates every request to this route, so by
 * the time the layout runs we're guaranteed an authenticated admin.
 * adminUsername() just reads ADMIN_USERNAME from env for the footer
 * label.
 */
export default async function AdminRouteLayout({ children }: { children: ReactNode }) {
  const counts = await countJobsByStatus();
  return (
    <AdminLayout counts={counts} adminUser={adminUsername()}>
      {children}
    </AdminLayout>
  );
}
