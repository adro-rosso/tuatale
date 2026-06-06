/**
 * Full-funnel end-to-end: draft → payment → pipeline → admin → shipped → email.
 *
 * One green test that exercises every Track A integration point in
 * sequence. Failure modes are covered by Cycle A.1-A.5's unit + Vitest
 * integration suites; this is the "does the chain hold together"
 * verification.
 *
 * Entry conditions (all read from the test-process env at startup):
 *   - TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY
 *   - ADMIN_USERNAME + ADMIN_PASSWORD
 *
 * Without them the suite skips — same pattern as
 * tests/integration/order-to-pipeline-job.test.ts (Vitest).
 *
 * The dev server is spawned with overridden env (see
 * playwright.config.ts:webServer.env) so:
 *   - NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → tuatale-test
 *   - STRIPE_WEBHOOK_SECRET = the dummy secret the fixture signs with
 *   - E2E_TEST_MODE_FAKE_EMAIL_SEND = true (Resend never called)
 *
 * The test process and the dev server therefore write to the same DB,
 * and the test's direct invocations of runPipelineJobHandler land in
 * the same place as the webhook's createOrderFromDraft.
 *
 * Runs only on chromium-desktop; mobile / tablet projects would exercise
 * identical code paths.
 */
import { test, expect } from '@playwright/test';
import {
  resetTestDb,
  getOrderByStripeSessionIdFromDb,
  getDraftByIdFromDb,
  getJobByIdFromDb,
  getJobByOrderIdFromDb,
  updateJobPdfUrlInDb,
} from './fixtures/db-helpers';
import { createCompletedDraft } from './fixtures/draft-fixture';
import { buildCheckoutCompletedEvent } from './fixtures/stripe-webhook-fixture';
import { invokeRunPipelineJob } from './fixtures/inngest-fixture';

const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const TEST_SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const skipSuite =
  !TEST_SUPABASE_URL || !TEST_SUPABASE_SERVICE_ROLE_KEY || !ADMIN_USERNAME || !ADMIN_PASSWORD;

const describe = skipSuite ? test.describe.skip : test.describe;

describe('full funnel', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    await resetTestDb();
  });

  test('draft → payment → pipeline → admin ship → email', async ({ page, request }, info) => {
    // Only run on chromium-desktop. The mobile / tablet projects would
    // exercise the same backend code paths; doubling the run wastes
    // tuatale-test row churn for no extra signal.
    test.skip(info.project.name !== 'chromium-desktop', 'desktop-project only');

    // ---- 1. Seed a completed draft ------------------------------------------
    const draft = await createCompletedDraft({
      customerEmail: 'e2e-full-funnel@tuatale.test',
      childName: 'Iris',
    });

    // ---- 2. Simulate Stripe webhook delivery --------------------------------
    const webhook = buildCheckoutCompletedEvent({
      draftId: draft.draftId,
      cookieId: draft.cookieId,
      amountCents: draft.estimatedPriceCents,
      customerEmail: draft.customerEmail,
    });
    const webhookResponse = await request.post('/api/stripe/webhook', {
      headers: {
        'stripe-signature': webhook.signature,
        'content-type': 'application/json',
      },
      data: webhook.payload,
    });
    expect(webhookResponse.status()).toBe(200);
    const webhookBody = await webhookResponse.json();
    expect(webhookBody.received).toBe(true);
    expect(webhookBody.pipelineDispatch).toBeDefined();

    // ---- 3. Assert: order created + draft converted + pipeline_job seeded ---
    const order = await getOrderByStripeSessionIdFromDb(webhook.sessionId);
    expect(order, 'order created by webhook').not.toBeNull();
    expect(order!.customer_email).toBe(draft.customerEmail);
    expect(order!.child_name).toBe(draft.childName);
    expect(order!.converted_from_draft_id).toBe(draft.draftId);
    expect(order!.amount_paid_cents).toBe(draft.estimatedPriceCents);

    const convertedDraft = await getDraftByIdFromDb(draft.draftId);
    expect(convertedDraft!.status).toBe('converted');
    expect(convertedDraft!.converted_to_order_id).toBe(order!.id);

    const initialJob = await getJobByOrderIdFromDb(order!.id);
    expect(initialJob, 'pipeline_job created by webhook').not.toBeNull();
    expect(initialJob!.status).toBe('pending');
    expect(initialJob!.attempt_count).toBe(0);

    // ---- 4. Invoke the Inngest handler directly (skip the 20s stub sleep) --
    const handlerResult = await invokeRunPipelineJob({
      jobId: initialJob!.id,
      orderId: order!.id,
      skipSleep: true,
    });
    expect(handlerResult.status).toBe('awaiting_review');
    expect(handlerResult.stubbed).toBe(true);

    // ---- 5. Assert: job transitioned through the lifecycle ------------------
    const jobAfterInngest = await getJobByIdFromDb(initialJob!.id);
    expect(jobAfterInngest!.status).toBe('awaiting_review');
    expect(jobAfterInngest!.started_at).not.toBeNull();
    expect(jobAfterInngest!.completed_at).not.toBeNull();
    expect(jobAfterInngest!.pdf_url).toBeDefined();

    // ---- 6. Patch to a non-stub PDF so the email-send path triggers --------
    // The shipJobAction guards against sending customers links to the
    // placeholder.tuatale.com stub domain. For the full-funnel test we
    // want to exercise the email path, so we patch in a real-shaped URL.
    const REAL_PDF_URL = `https://r2.tuatale.test/orders/${order!.id}/book.pdf`;
    await updateJobPdfUrlInDb(initialJob!.id, REAL_PDF_URL);

    // ---- 7. Authenticate to admin + open the detail page -------------------
    await page.context().setHTTPCredentials({
      username: ADMIN_USERNAME!,
      password: ADMIN_PASSWORD!,
    });
    await page.goto(`/admin/orders/${initialJob!.id}`);

    // ---- 8. Assert: detail page renders the order's data --------------------
    await expect(
      page.getByRole('heading', { name: `${draft.childName}'s book`, level: 2 }),
    ).toBeVisible();
    await expect(page.getByText(draft.customerEmail)).toBeVisible();

    // ---- 9. Click Ship ------------------------------------------------------
    await page.getByRole('button', { name: /ship to customer/i }).click();

    // ---- 10. Assert: redirect back to the queue, job is shipped in DB ------
    await expect(page).toHaveURL(/\/admin\/orders\/?(?:\?.*)?$/);

    const jobAfterShip = await getJobByIdFromDb(initialJob!.id);
    expect(jobAfterShip!.status).toBe('shipped');
    expect(jobAfterShip!.shipped_at).not.toBeNull();
    expect(jobAfterShip!.reviewed_by).toBe(ADMIN_USERNAME);

    // ---- 11. Assert: email side effect — synthetic message id recorded -----
    // Resend is short-circuited by E2E_TEST_MODE_FAKE_EMAIL_SEND on the
    // dev server, so we get a synthetic msg_test_e2e_... message id +
    // a non-null notification_sent_at + a null notification_error.
    expect(jobAfterShip!.notification_sent_at).not.toBeNull();
    expect(jobAfterShip!.notification_message_id).toMatch(/^msg_test_e2e_/);
    expect(jobAfterShip!.notification_error).toBeNull();
  });
});
