/**
 * Regression: when a step form fails server-side validation, every
 * field the customer typed must retain its value (including the
 * field that failed validation — they need to see what they typed in
 * order to fix it).
 *
 * Phase 2.C originally suffered the bug on /start/child: React 19's
 * `<form action={fn}>` auto-resets uncontrolled inputs once the
 * action returns, and the form sourced its defaultValue from the
 * (still-empty) draft. The fix has the action echo the raw
 * submitted values back in its return state; ChildForm reads them
 * for defaultValue so the post-reset state shows the typed input.
 *
 * Secondaries (direct-call action) and Theme (controlled inputs
 * bound to useState) preserve via React state — no auto-reset
 * applies — but we cover them here as anti-regression.
 */
import { test, expect, type Page } from '@playwright/test';

// W-F: /start now lands on the art-style picker first. Watercolour is the
// default selection, so continue straight through to the character step.
async function passStyleStep(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/start\/style$/);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/child$/);
}

const CHILD_NAME = 'Iris';
const CHILD_AGE = '5-7';
const CHILD_GENDER = 'girl';
const CHILD_APPEARANCE_VALID =
  'Iris has curly brown hair just past her shoulders, brown eyes, and a small gap between her two front teeth. She loves wearing her red rain boots.';
const CHILD_APPEARANCE_TOO_SHORT = 'Too short';

test('child step preserves typed input on validation failure', async ({ page }) => {
  await page.goto('/start');
  await passStyleStep(page);

  // Fill all four fields but make appearance fail the 50-char min.
  await page.locator('input[name="name"]').fill(CHILD_NAME);
  await page.locator('select[name="age_range"]').selectOption(CHILD_AGE);
  await page.locator(`input[name="gender"][value="${CHILD_GENDER}"]`).check({ force: true });
  await page.locator('textarea[name="appearance"]').fill(CHILD_APPEARANCE_TOO_SHORT);

  await page.getByRole('button', { name: /continue/i }).click();

  // Stayed on /start/child — validation failed, no redirect.
  await expect(page).toHaveURL(/\/start\/child$/);
  // Brand-voice error surfaced inline on the appearance field. With structured
  // inputs the appearance requirement moved to the structured-OR-free-text rule,
  // so a too-short, feature-less submission now surfaces this message.
  await expect(
    page.getByText('Build their character above, or tell us in 50+ characters.').first(),
  ).toBeVisible();

  // Every typed field — including the failing one — must be preserved.
  await expect(page.locator('input[name="name"]')).toHaveValue(CHILD_NAME);
  await expect(page.locator('select[name="age_range"]')).toHaveValue(CHILD_AGE);
  await expect(page.locator(`input[name="gender"][value="${CHILD_GENDER}"]`)).toBeChecked();
  await expect(page.locator('textarea[name="appearance"]')).toHaveValue(CHILD_APPEARANCE_TOO_SHORT);

  // And fixing the failing field then resubmitting advances normally.
  await page.locator('textarea[name="appearance"]').fill(CHILD_APPEARANCE_VALID);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);
});

test('theme step preserves typed text on validation failure', async ({ page }) => {
  // Advance past /start/child so we land on /start/theme with a usable draft.
  await page.goto('/start');
  await passStyleStep(page);
  await page.locator('input[name="name"]').fill(CHILD_NAME);
  await page.locator('select[name="age_range"]').selectOption(CHILD_AGE);
  await page.locator(`input[name="gender"][value="${CHILD_GENDER}"]`).check({ force: true });
  await page.locator('textarea[name="appearance"]').fill(CHILD_APPEARANCE_VALID);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/theme$/);

  // Click a template — sets selectedId + populates textarea with the
  // resolved starter sentence.
  await page.getByRole('button', { name: /your first day of school/i }).click();
  const populated = await page.locator('textarea[name="theme"]').inputValue();
  expect(populated).toContain(CHILD_NAME);

  // Truncate to a too-short string and submit.
  await page.locator('textarea[name="theme"]').fill('Too short.');
  await page.getByRole('button', { name: /continue/i }).click();

  // Stayed on /start/theme; the typed text is preserved.
  await expect(page).toHaveURL(/\/start\/theme$/);
  await expect(page.getByText('A little more detail would help.').first()).toBeVisible();
  await expect(page.locator('textarea[name="theme"]')).toHaveValue('Too short.');
});

test('secondaries step preserves card state on validation failure', async ({ page }) => {
  // Set up: advance past /start/child to /start/secondaries.
  await page.goto('/start');
  await passStyleStep(page);
  await page.locator('input[name="name"]').fill(CHILD_NAME);
  await page.locator('select[name="age_range"]').selectOption(CHILD_AGE);
  await page.locator(`input[name="gender"][value="${CHILD_GENDER}"]`).check({ force: true });
  await page.locator('textarea[name="appearance"]').fill(CHILD_APPEARANCE_VALID);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  // Add a card. Fill name + subject_type=human, then submit WITHOUT
  // picking a gender — the schema's .refine() requires gender for
  // human subjects.
  await page.getByRole('button', { name: /add another character/i }).click();
  await page.locator('input[type="text"]').first().fill('Beatrix');
  await page.getByText('A person', { exact: true }).click();
  // Also fill relationship + appearance so the only missing thing is gender.
  await page.locator('input[type="text"]').nth(1).fill('big sister');
  await page
    .locator('textarea')
    .fill(
      'Beatrix is nine, taller than Iris, with the same brown hair but kept in a long ponytail.',
    );

  await page.getByRole('button', { name: /continue/i }).click();

  // Stayed on /start/secondaries — validation failed because gender is
  // missing for a human secondary. The card and its typed values must
  // be preserved.
  await expect(page).toHaveURL(/\/start\/secondaries$/);
  await expect(page.locator('input[type="text"]').first()).toHaveValue('Beatrix');
  await expect(page.locator('input[type="text"]').nth(1)).toHaveValue('big sister');
  await expect(page.locator('textarea')).toHaveValue(
    'Beatrix is nine, taller than Iris, with the same brown hair but kept in a long ponytail.',
  );
});
