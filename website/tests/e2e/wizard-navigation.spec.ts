/**
 * End-to-end smoke for the wizard chassis.
 *
 * Phase 2.B walked an empty draft straight through with the generic
 * "Continue" button. Phase 2.C added real form fields + per-step
 * validation, so this test now fills each step before advancing.
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
import { test, expect, type Page } from '@playwright/test';

const CHILD = {
  name: 'Iris',
  age_range: '5-7',
  gender: 'girl',
  appearance:
    'Iris has curly brown hair just past her shoulders, brown eyes, and a small gap between her two front teeth. She loves wearing her red rain boots.',
} as const;

const THEME_TEXT =
  'Iris discovers a tiny door at the back of the garden shed. Behind it, a world only as big as her hand — and she has to figure out who lives there before they figure out she does.';

async function fillChildStep(page: Page): Promise<void> {
  await page.locator('input[name="name"]').fill(CHILD.name);
  await page.locator('select[name="age_range"]').selectOption(CHILD.age_range);
  // sr-only radios are pointer-intercepted by their visible labels.
  // The radio IS the form-data source though, so a force-check on it
  // (rather than clicking the wrapping label) keeps the selector tied
  // to the actual input.
  await page.locator(`input[name="gender"][value="${CHILD.gender}"]`).check({ force: true });
  await page.locator('textarea[name="appearance"]').fill(CHILD.appearance);
}

async function fillThemeStep(page: Page): Promise<void> {
  await page.locator('textarea[name="theme"]').fill(THEME_TEXT);
}

test('happy path: fill all required steps and reach payment', async ({ page }) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);
  await expect(page.getByRole('heading', { level: 2, name: 'About your child' })).toBeVisible();

  await fillChildStep(page);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);
  await expect(
    page.getByRole('heading', { level: 2, name: `Friends and family for ${CHILD.name}` }),
  ).toBeVisible();

  // Secondaries is optional — skip without adding any cards.
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/theme$/);
  await expect(
    page.getByRole('heading', { level: 2, name: `Choose a theme for ${CHILD.name}'s story` }),
  ).toBeVisible();

  await fillThemeStep(page);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/preview$/);

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/review$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Review the details' })).toBeVisible();
  // Review surfaces the typed values.
  await expect(page.getByText(CHILD.name).first()).toBeVisible();

  await page.getByRole('button', { name: /looks good.*continue/i }).click();
  await expect(page).toHaveURL(/\/start\/payment$/);
  // Payment page shows the order summary + a Pay button. We don't
  // click Pay — that would hit live Stripe.
  await expect(page.getByRole('heading', { level: 1, name: `A book for ${CHILD.name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /^pay \$/i })).toBeVisible();
  // No Continue on payment (Stripe Checkout is the next step).
  await expect(page.getByRole('button', { name: /continue/i })).toHaveCount(0);
  // Back is still available.
  await expect(page.getByRole('button', { name: /back/i })).toBeVisible();
});

test('child step rejects empty submission and surfaces brand-voice errors', async ({ page }) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);
  // Click Continue with no fields filled.
  await page.getByRole('button', { name: /continue/i }).click();
  // Stays on /start/child, validation errors visible.
  await expect(page).toHaveURL(/\/start\/child$/);
  await expect(page.getByText("We'll need this.").first()).toBeVisible();
});

test('back button reverses navigation without rewinding progress', async ({ page }) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);
  await fillChildStep(page);
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

test('returning customer lands on furthest step reached, with prior input preserved', async ({
  page,
}) => {
  // Advance to /start/theme so draft.current_step == 'theme'.
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);
  await fillChildStep(page);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/theme$/);

  // Simulate fresh tab: visit /start directly. Proxy should land us at
  // the furthest reached step, not back at /start/child.
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/theme$/);

  // And going back to /start/child shows the previously typed values.
  await page.goto('/start/child');
  await expect(page.locator('input[name="name"]')).toHaveValue(CHILD.name);
  await expect(page.locator('select[name="age_range"]')).toHaveValue(CHILD.age_range);
  await expect(page.locator('textarea[name="appearance"]')).toHaveValue(CHILD.appearance);
});

test('GET /start/reset clears cookie and lands back at /start/child with a fresh one', async ({
  page,
  context,
}) => {
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);
  await fillChildStep(page);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/start\/secondaries$/);

  const beforeCookies = await context.cookies();
  const beforeCookie = beforeCookies.find((c) => c.name === 'tuatale_draft_id');
  expect(beforeCookie).toBeDefined();
  const beforeDraftId = beforeCookie?.value;

  await page.goto('/start/reset');
  await expect(page).toHaveURL(/\/start\/child$/);

  const afterCookies = await context.cookies();
  const afterCookie = afterCookies.find((c) => c.name === 'tuatale_draft_id');
  expect(afterCookie).toBeDefined();
  expect(afterCookie?.value).not.toBe(beforeDraftId);
  expect(afterCookie?.value).toMatch(/^[0-9a-f-]{36}$/);

  // Fresh cookie ⇒ fresh draft ⇒ empty form.
  await expect(page.locator('input[name="name"]')).toHaveValue('');
});

test('proxy sets the draft cookie on first /start visit', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/start');
  await expect(page).toHaveURL(/\/start\/child$/);

  const cookies = await context.cookies();
  const draftCookie = cookies.find((c) => c.name === 'tuatale_draft_id');
  expect(draftCookie, 'tuatale_draft_id cookie must be set').toBeDefined();
  expect(draftCookie?.httpOnly, 'cookie must be httpOnly').toBe(true);
  expect(draftCookie?.sameSite?.toLowerCase()).toBe('lax');
  expect(draftCookie?.value).toMatch(/^[0-9a-f-]{36}$/);
});
