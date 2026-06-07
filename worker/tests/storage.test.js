// worker/tests/storage.test.js — integration against tuatale-TEST Storage.
// Requires worker/.env.local pointing at tuatale-test (service role).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { uploadBookPdf, regenerateSignedUrl, bookPdfPath, BUCKET } from "../src/storage.js";
import { setClientForTesting } from "../src/db.js";
import { ensureBucket, makeTinyPdf, deleteStorageObject } from "./helpers.js";

// A throwaway orderId so we never collide with real data and can clean up.
const orderId = `test-${crypto.randomUUID()}`;
const path = bookPdfPath(orderId);

beforeAll(async () => {
  await ensureBucket(BUCKET);
});

afterAll(async () => {
  await deleteStorageObject(BUCKET, path);
});

describe("uploadBookPdf", () => {
  it("uploads a PDF and returns a fetchable 7-day signed URL", async () => {
    const pdf = await makeTinyPdf("upload test");
    const { pdfUrl, storagePath } = await uploadBookPdf({ orderId, pdfBytes: pdf });

    expect(storagePath).toBe(path);
    expect(pdfUrl).toMatch(/^https?:\/\//);

    const res = await fetch(pdfUrl);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    // Fetched bytes are the same PDF we uploaded (starts with %PDF).
    expect(body.subarray(0, 4).toString()).toBe("%PDF");
    expect(body.length).toBe(pdf.length);
  });

  it("upsert overwrites the previous file at the same path", async () => {
    const first = await makeTinyPdf("first");
    const second = await makeTinyPdf("second-version-longer-content-here");
    await uploadBookPdf({ orderId, pdfBytes: first });
    const { pdfUrl } = await uploadBookPdf({ orderId, pdfBytes: second });

    const res = await fetch(pdfUrl);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(second.length); // got the overwrite, not the first
  });
});

describe("regenerateSignedUrl", () => {
  it("returns a valid, fetchable signed URL for an existing object", async () => {
    // Note: Supabase signed URLs are deterministic for a given (path, expiry
    // second) — the token is a JWT whose `exp` is now+ttl rounded to the second,
    // so re-signing within the same second yields the SAME string. The contract
    // that matters is that regeneration produces a WORKING url (used by admin to
    // hand out a fresh link once the original 7-day window lapses), not that the
    // string differs. So we assert validity + fetchability, not inequality.
    const pdf = await makeTinyPdf("resign");
    const { storagePath } = await uploadBookPdf({ orderId, pdfBytes: pdf });
    const url = await regenerateSignedUrl(storagePath);
    expect(url).toMatch(/^https?:\/\//);
    const res = await fetch(url);
    expect(res.status).toBe(200);
  });
});

describe("failure handling", () => {
  it("throws (does not silently succeed) when the client is unauthorized", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Inject a client built with a bogus key → uploads must reject.
    const bogus = createClient(new URL(url).origin, "bogus.invalid.key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    setClientForTesting(bogus);
    try {
      const pdf = await makeTinyPdf("nope");
      await expect(uploadBookPdf({ orderId: "unauth", pdfBytes: pdf })).rejects.toThrow(
        /upload failed/i,
      );
    } finally {
      setClientForTesting(null); // restore real (env-built) client for other files
    }
  });
});
