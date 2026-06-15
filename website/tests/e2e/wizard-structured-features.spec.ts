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

  // The 4 identity axes = structured-complete — now image-picker radio cards
  // (sr-only radios, force-checked like the gender field). 'tousled' ∈ boy set.
  await page.locator('input[name="hair_colour"][value="brown"]').check({ force: true });
  await page.locator('input[name="hair_style"][value="tousled"]').check({ force: true });
  await page.locator('input[name="skin_tone"][value="tan"]').check({ force: true });
  await page.locator('input[name="eye_colour"][value="brown"]').check({ force: true });
  // build + glasses stay simple selects.
  await page.locator('select[name="build"]').selectOption('sturdy');
  await page.locator('select[name="glasses"]').selectOption('yes');

  // Deliberately leave the free-text appearance EMPTY.
  await expect(page.locator('textarea[name="appearance"]')).toHaveValue('');

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  // Returning to the child step shows the selections repopulated.
  await page.goto('/start/child');
  await expect(page.locator('input[name="hair_colour"][value="brown"]')).toBeChecked();
  await expect(page.locator('input[name="hair_style"][value="tousled"]')).toBeChecked();
  await expect(page.locator('input[name="eye_colour"][value="brown"]')).toBeChecked();
  await expect(page.locator('select[name="build"]')).toHaveValue('sturdy');
  await expect(page.locator('select[name="glasses"]')).toHaveValue('yes');
});

test('gender gates the hair_style options (renderability constraint)', async ({ page }) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  const hairStyleValues = async () =>
    page.locator('input[name="hair_style"]').evaluateAll((els) =>
      els.map((o) => (o as HTMLInputElement).value).filter(Boolean),
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
