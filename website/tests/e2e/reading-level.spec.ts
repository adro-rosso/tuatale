/**
 * E2E — reading-level picker on the child step (render-verify).
 *
 * Verifies the interactive behaviour a unit test can't ("green tests != it
 * renders"): the card renders, the default follows the age band, the sample
 * image swaps, an override pins and persists against later age changes, and the
 * submitted value is '' (→ NULL server-side) until the parent actually clicks.
 *
 * Runs against the playwright-spawned dev server (playwright.config points
 * NEXT_PUBLIC_SUPABASE_URL at tuatale-test). Requires :3000 FREE. Not run in CI.
 */
import { test, expect, type Page } from '@playwright/test';

async function passStyleStep(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/start\/style$/);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/child$/);
}

const hidden = (page: Page) => page.locator('input[name="reading_level"]');
const levelBtn = (page: Page, lvl: string) =>
  page.getByRole('button', { name: lvl, exact: true });
const sampleImg = (page: Page) => page.locator('figure img');

test('reading-level picker: default-from-age, sample swap, override persists, null-until-override', async ({
  page,
}) => {
  await page.goto('/start');
  await passStyleStep(page);
  await page.locator('input[name="name"]').fill('Mila');

  // --- Age 3-5 (untouched) → SIMPLEST default, but hidden value '' (→ NULL) ---
  await page.locator('select[name="age_range"]').selectOption('3-5');
  await expect(levelBtn(page, 'simplest')).toHaveAttribute('aria-pressed', 'true');
  await expect(hidden(page)).toHaveValue(''); // untouched → stored NULL
  await expect(sampleImg(page)).toHaveAttribute('src', /simplest\.webp/);

  // --- Change age to 7-9 (still untouched) → default FOLLOWS age + sample swaps ---
  await page.locator('select[name="age_range"]').selectOption('7-9');
  await expect(levelBtn(page, 'advanced')).toHaveAttribute('aria-pressed', 'true');
  await expect(levelBtn(page, 'simplest')).toHaveAttribute('aria-pressed', 'false');
  await expect(hidden(page)).toHaveValue(''); // STILL untouched → NULL
  await expect(sampleImg(page)).toHaveAttribute('src', /advanced\.webp/);

  // --- Click SIMPLEST (override; differs from the advanced default) ---
  await levelBtn(page, 'simplest').click();
  await expect(hidden(page)).toHaveValue('simplest'); // concrete → stored verbatim
  await expect(levelBtn(page, 'simplest')).toHaveAttribute('aria-pressed', 'true');
  await expect(sampleImg(page)).toHaveAttribute('src', /simplest\.webp/);

  // --- Override PERSISTS against a later age change (does NOT snap to 5-7's default) ---
  await page.locator('select[name="age_range"]').selectOption('5-7');
  await expect(levelBtn(page, 'simplest')).toHaveAttribute('aria-pressed', 'true');
  await expect(levelBtn(page, 'standard')).toHaveAttribute('aria-pressed', 'false');
  await expect(hidden(page)).toHaveValue('simplest');

  // Screenshot the card for the review deliverable.
  await page.locator('section', { hasText: 'Reading level' }).first()
    .screenshot({ path: 'test-results/reading-level-card.png' });
});
