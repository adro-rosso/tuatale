// worker/tests/helpers.js — shared test fixtures for the integration suites.
//
// Talks to the tuatale-TEST project via the same service-role client the worker
// uses (worker/.env.local must point at tuatale-test). Provides minimal,
// self-cleaning order/job seeding + a tiny PDF mint for storage tests.

import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib"; // resolves from the repo-root node_modules
import { getClient } from "../src/db.js";

/** Insert a minimal valid orders row. Returns the inserted row. */
export async function insertTestOrder(overrides = {}) {
  const payload = {
    customer_email: `test+${crypto.randomUUID()}@example.com`,
    child_name: "Elena",
    child_age: 5,
    child_gender: "girl",
    child_appearance:
      "wavy auburn hair to her shoulders, fair skin with freckles, hazel eyes, yellow rain boots, denim overalls",
    secondaries: [],
    theme: "the day Elena and Pepper got lost in the park and found their way home",
    age_range: "5-7",
    stripe_session_id: `cs_test_${crypto.randomUUID()}`,
    amount_paid_cents: 7900,
    currency: "aud",
    paid_at: new Date().toISOString(),
    ...overrides,
  };
  const { data, error } = await getClient()
    .from("orders")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`insertTestOrder failed: ${error.message}`);
  return data;
}

/** Insert a pipeline_jobs row for an order. Returns the inserted row. */
export async function insertTestJob(orderId, overrides = {}) {
  const { data, error } = await getClient()
    .from("pipeline_jobs")
    .insert({ order_id: orderId, status: "pending", ...overrides })
    .select()
    .single();
  if (error) throw new Error(`insertTestJob failed: ${error.message}`);
  return data;
}

/** Delete a job (if any) then the order. Safe to call in afterAll. */
export async function deleteOrderCascade(orderId) {
  if (!orderId) return;
  await getClient().from("pipeline_jobs").delete().eq("order_id", orderId);
  await getClient().from("orders").delete().eq("id", orderId);
}

/** Remove an uploaded book PDF from Storage (best-effort cleanup). */
export async function deleteStorageObject(bucket, path) {
  try {
    await getClient().storage.from(bucket).remove([path]);
  } catch {
    /* best-effort */
  }
}

/** Mint a tiny but valid one-page PDF as a Uint8Array. */
export async function makeTinyPdf(text = "tuatale test") {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(text, { x: 20, y: 100, size: 12 });
  return await doc.save();
}

/**
 * Ensure the tuatale-books bucket exists in the target (test) project. The SQL
 * migration creates it in prod/test once Adro applies it; this lets the storage
 * + run-pipeline integration tests be self-sufficient against tuatale-test in
 * the meantime (idempotent — createBucket on an existing id is ignored).
 */
export async function ensureBucket(bucket = "tuatale-books") {
  const client = getClient();
  const { data: existing } = await client.storage.getBucket(bucket);
  if (existing) return;
  const { error } = await client.storage.createBucket(bucket, { public: false });
  // Ignore "already exists" races; surface anything else.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`ensureBucket(${bucket}) failed: ${error.message}`);
  }
}
