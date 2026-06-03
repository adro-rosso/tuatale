/**
 * Phase 2.B end-to-end smoke: drive the wizard chassis through all six
 * steps in a real browser, verify URL transitions, cookie hygiene, and
 * the payment-step "no continue button" behaviour.
 *
 * Runs against a local dev server (playwright.config.ts's webServer
 * boots `npm run dev` automatically). The dev server uses .env.local —
 * so this test creates real draft rows in whichever Supabase project
 * NEXT_PUBLIC_SUPABASE_URL points at. Adro's .env.local points at
 * tuatale-prod by default; minimal-volume writes per run, acceptable
 * pre-launch.
 *
 * NOT run in CI — Playwright browser install is local-only for now.
 */
import { test, expect } from '@playwright/test';

const STEPS = [
  { path: '/start/child', heading: 'About your child' },
  { path: '/start/secondaries', heading: 'Friends, pets, or favourite toys' },
  { path: '/start/theme', heading: 'Choose a theme' },
  { path: '/start/preview', heading: 'See a glimpse' },
  { path: '/start/review', heading: 'Review the details' },
  { path: '/start/payment', heading: 'Almost there' },
] as const;

test('wizard chassis: /start → /start/child redirect + Continue navigation through all steps', async ({
  page,
}) => {
  // /start always redirects to the first step.
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  // Continue button takes us through each subsequent step.
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i]!;
    await expect(page).toHaveURL(new RegExp(`${step.path}$`));
    await expect(page.getByRole('heading', { level: 2, name: step.heading })).toBeVisible();
    if (i < STEPS.length - 1) {
      await page.getByRole('button', { name: /continue/i }).click();
    }
  }

  // Final step: no Continue button (payment step submits via Phase 2.E).
  await expect(page).toHaveURL(/\/start\/payment$/);
  await expect(page.getByRole('button', { name: /continue/i })).toHaveCount(0);
  // But Back is still available.
  await expect(page.getByRole('button', { name: /back/i })).toBeVisible();
});

test('back button reverses navigation without rewinding progress', async ({ page }) => {
  // Each click triggers a Server Action that redirects via HTTP — wait
  // for each URL transition before the next click so we don't race
  // against the previous form submission's network round-trip.
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/theme$/);

  await page.getByRole('button', { name: /back/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  await page.getByRole('button', { name: /back/i }).click();
  await expect(page).toHaveURL(/\/start\/child$/);
  // First step has no Back button.
  await expect(page.getByRole('button', { name: /back/i })).toHaveCount(0);
});

test('proxy sets the draft cookie on first /start visit', async ({ page, context }) => {
  // Start with an empty context (no cookies).
  await context.clearCookies();
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  const cookies = await context.cookies();
  const draftCookie = cookies.find((c) => c.name === 'tuatale_draft_id');
  expect(draftCookie, 'tuatale_draft_id cookie must be set').toBeDefined();
  expect(draftCookie?.httpOnly, 'cookie must be httpOnly').toBe(true);
  expect(draftCookie?.sameSite?.toLowerCase()).toBe('lax');
  // Value is a UUID v4-shaped string.
  expect(draftCookie?.value).toMatch(/^[0-9a-f-]{36}$/);
});
