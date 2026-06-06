/**
 * Admin dashboard end-to-end smoke.
 *
 * Skipped entirely when ADMIN_USERNAME / ADMIN_PASSWORD env vars
 * aren't set in the playwright process. Without them, the dev server
 * (which inherits the same env) would 401 every admin request — so
 * the auth-success tests can't run.
 *
 * These tests don't seed pipeline_jobs / orders. Whichever Supabase
 * project the dev server points at (prod via .env.local per the
 * established convention) will have whatever data already exists.
 * The assertions are about page structure, not row content.
 *
 * NOT run in CI.
 */
import { test, expect } from '@playwright/test';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const skipSuite = !ADMIN_USERNAME || !ADMIN_PASSWORD;

const describe = skipSuite ? test.describe.skip : test.describe;

const VALID_HEADER = ADMIN_USERNAME && ADMIN_PASSWORD
  ? `Basic ${Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64')}`
  : '';

describe('admin dashboard', () => {
  test.use({
    httpCredentials: {
      username: ADMIN_USERNAME ?? '',
      password: ADMIN_PASSWORD ?? '',
    },
  });

  test('/admin/orders with credentials renders the queue page', async ({ page }) => {
    await page.goto('/admin/orders');
    // The Admin chrome is present (Wordmark + the "Admin" label).
    await expect(page.getByText('Admin', { exact: true })).toBeVisible();
    // Queue tiles row appears.
    await expect(page.getByRole('navigation', { name: 'Queue summary' })).toBeVisible();
    // Default status filter is awaiting_review — the heading reads "Awaiting review".
    await expect(page.getByRole('heading', { name: 'Awaiting review' })).toBeVisible();
  });

  test('/admin/orders?status=shipped switches the heading to Shipped', async ({ page }) => {
    await page.goto('/admin/orders?status=shipped');
    await expect(page.getByRole('heading', { name: 'Shipped' })).toBeVisible();
  });

  test('Filter chips link to the right status', async ({ page }) => {
    await page.goto('/admin/orders');
    // The "Failed" chip is a link to ?status=failed.
    const failedLink = page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: 'Failed' });
    await failedLink.click();
    await expect(page).toHaveURL(/\?status=failed$/);
    await expect(page.getByRole('heading', { name: 'Failed' })).toBeVisible();
  });

  test('/admin/orders/<random-uuid> renders 404', async ({ page }) => {
    const res = await page.goto('/admin/orders/00000000-0000-0000-0000-000000000000');
    expect(res?.status()).toBe(404);
  });
});

test.describe('admin auth gate', () => {
  // Auth-gate tests run unconditionally — they assert 401 without
  // credentials, which doesn't require the env to be set.
  test('/admin/orders without credentials returns 401', async ({ request }) => {
    const res = await request.get('/admin/orders');
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toMatch(/^Basic realm=/);
  });

  test('/admin without credentials returns 401', async ({ request }) => {
    const res = await request.get('/admin');
    expect(res.status()).toBe(401);
  });
});
