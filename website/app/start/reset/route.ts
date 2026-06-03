/**
 * GET /start/reset — clear the wizard cookie and bounce back to /start.
 *
 * Use case: the customer's cookie points at a draft row that no longer
 * exists (pg_cron deleted it after 30 days, or some other inconsistent
 * state). Visiting /start/reset clears the cookie; the subsequent
 * /start redirect then re-enters the Proxy, which mints a brand-new
 * draft + cookie.
 *
 * This is a Route Handler (not a page) so it can set cookies directly
 * — Next 16 restricts cookie writes to Server Functions and Route
 * Handlers.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME } from '@/lib/draft-cookie';

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, '', {
    maxAge: 0,
    path: '/',
  });
  redirect('/start');
}
