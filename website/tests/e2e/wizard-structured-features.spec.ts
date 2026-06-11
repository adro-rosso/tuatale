/**
 * E2E — structured character inputs (Spec: structured inputs, 2026-06-11).
 *
 * Covers the two behaviours unique to the structured path:
 *   1. A structured-complete character (the 4 identity axes) lets the child step
 *      advance with NO free-text appearance — the OR-requirement.
 *   2. The gender → hair_style options gate is live in the UI (boy gets the
 *      restricted set; girl gets the full set).
 *
 * Runs against the playwright-spawned dev server, which playwright.config.ts
 * points at tuatale-test (NEXT_PUBLIC_SUPABASE_URL override) — so the
 * child_features write lands on the test project (which has the column).
 * Requires :3000 to be FREE so playwright spawns its own server rather than
 * reusing a prod-env `npm run dev`.
 *
 * NOT run in CI — Playwright browser install is local-only for now.
 */
import { test, expect } from '@playwright/test';

test('structured-complete character with no free text advances past the child step', async ({
  page,
}) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  await page.locator('input[name="name"]').fill('Sam');
  await page.locator('select[name="age_range"]').selectOption('5-7');
  await page.locator('input[name="gender"][value="boy"]').check({ force: true });

  // The 4 identity axes = structured-complete. hair_style 'tousled' is in the boy set.
  await page.locator('select[name="hair_colour"]').selectOption('brown');
  await page.locator('select[name="hair_style"]').selectOption('tousled');
  await page.locator('select[name="skin_tone"]').selectOption('tan');
  await page.locator('select[name="eye_colour"]').selectOption('brown');
  // Optional extras exercised too.
  await page.locator('select[name="outfit_tee"]').selectOption('green');
  await page.locator('select[name="mark_type"]').selectOption('mole');
  await page.locator('select[name="mark_side"]').selectOption('left');

  // Deliberately leave the free-text appearance EMPTY.
  await expect(page.locator('textarea[name="appearance"]')).toHaveValue('');

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  // Returning to the child step shows the structured selections repopulated.
  await page.goto('/start/child');
  await expect(page.locator('select[name="hair_colour"]')).toHaveValue('brown');
  await expect(page.locator('select[name="hair_style"]')).toHaveValue('tousled');
  await expect(page.locator('select[name="eye_colour"]')).toHaveValue('brown');
  await expect(page.locator('select[name="outfit_tee"]')).toHaveValue('green');
  await expect(page.locator('select[name="mark_side"]')).toHaveValue('left');
});

test('gender gates the hair_style options (renderability constraint)', async ({ page }) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  const hairStyleValues = async () =>
    page.locator('select[name="hair_style"] option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );

  // Boy → restricted set (no long/ponytail/pigtails/braids/bun/shoulder-length).
  await page.locator('input[name="gender"][value="boy"]').check({ force: true });
  const boyStyles = await hairStyleValues();
  expect(boyStyles).toContain('buzzed');
  expect(boyStyles).not.toContain('long');
  expect(boyStyles).not.toContain('pigtails');

  // Girl → full set (long/pigtails available).
  await page.locator('input[name="gender"][value="girl"]').check({ force: true });
  const girlStyles = await hairStyleValues();
  expect(girlStyles).toContain('long');
  expect(girlStyles).toContain('pigtails');
});
