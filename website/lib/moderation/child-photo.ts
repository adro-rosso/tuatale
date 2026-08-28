/**
 * Child-photo moderation — a FAIL-CLOSED suitability check run before a child reference
 * photo is accepted. Uses Anthropic Haiku 4.5 vision (reusing ANTHROPIC_API_KEY + the raw
 * fetch pattern from improve-story). Server-only.
 *
 * ⚠️ OPEN LEGAL DECISION (Adro's legal workstream): this is a SUITABILITY + basic-safety
 * check — it rejects obvious unsuitability (not a child/person, explicit/violent/unsafe
 * content, or not a real photo). It is NOT a CSAM detector; worst-case protection needs a
 * specialized hash-matching / CSAM-classification service (PhotoDNA / Thorn-class), which
 * is a separate provider + legal decision. Do NOT treat passing this check as clearance of
 * that risk. Tracked as an open decision until legal signs off.
 *
 * FAIL-CLOSED everywhere: a missing key, an API error, a timeout, an unparseable answer, or
 * any "not clearly suitable" verdict all return { ok:false } → the caller REJECTS the photo.
 * The only path to acceptance is an explicit, parseable suitable:true.
 */

// Haiku 4.5 — cheap + fast; vision-capable. ~$0.002–0.005 per check.
const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 20_000;

// SAFETY-ONLY (Adro's decision 2026-08-28): this gate checks SAFETY, not age or identity.
// A child-book companion is very often an adult (a parent, a grandparent), so rejecting a
// photo for being an adult would wrongly block legitimate input. Age-appropriateness of the
// PROTAGONIST is a product concern handled later by the child's stated age at the sheet
// stage — never by this gate. Only explicit/violent content and non-photos are rejected.
const SYSTEM_PROMPT = `You are a content-safety reviewer for a children's picture-book service. A customer uploads a photo of a real person — a child, a parent, a grandparent, or another family member — to have them illustrated as a storybook character. Your ONLY job is a SAFETY check. Do NOT judge the person's age, or whether they are the "right" person — accept an ordinary, appropriate photo of a real person of ANY age.

SUITABLE (suitable: true) — an ordinary, appropriate photograph of one or more real people of ANY age (adults included): a normal portrait or snapshot, clothed, non-explicit, non-violent.

NOT SUITABLE (suitable: false) — ONLY these:
- sexual, nude, or otherwise explicit content;
- violence, gore, weapons used threateningly, or other distressing/unsafe content;
- the image is not a genuine photo of a real person (a document, screenshot, meme, drawing/illustration, logo, or a scene/object with no person in it).

Do NOT reject a photo for being an adult, for the person's age, or for who they are — only for the safety reasons above. If you are unsure whether the content is unsafe, choose suitable: false.

Respond with ONLY a JSON object, nothing else:
{"suitable": true|false, "reason": "<short reason>"}`;

/**
 * `category` lets the caller pick copy: 'unsafe' = a real content rejection (show the safety
 * message); 'unavailable' = we couldn't complete the check (no key, HTTP/network error,
 * timeout, or an unparseable answer) — the photo may be perfectly fine, so show a "try again"
 * message, never accuse it. Either way the photo is REJECTED (fail-closed).
 */
export type ModerationResult = { ok: true } | { ok: false; category: 'unsafe' | 'unavailable'; reason: string };

/** Extract the first {...} JSON object and validate the shape. */
function parseVerdict(raw: string): { suitable: boolean; reason: string } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.suitable !== 'boolean') return null; // fail-closed: no clear boolean → reject
  return { suitable: obj.suitable, reason: typeof obj.reason === 'string' ? obj.reason : '' };
}

/**
 * Moderate a child reference photo (PNG bytes). Returns { ok:true } ONLY on an explicit,
 * parseable suitable:true; every other outcome (incl. errors) is { ok:false } — fail-closed.
 */
export async function moderateChildPhoto(pngBytes: Buffer): Promise<ModerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[moderateChildPhoto] no ANTHROPIC_API_KEY — rejecting (fail-closed)');
    return { ok: false, category: 'unavailable', reason: 'unavailable' };
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBytes.toString('base64') } },
              { type: 'text', text: 'Assess this photo per the rules. Respond with ONLY the JSON.' },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[moderateChildPhoto] Anthropic ${res.status} — rejecting (fail-closed)`);
      return { ok: false, category: 'unavailable', reason: 'error' };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const rawText = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const verdict = parseVerdict(rawText);
    if (!verdict) {
      // We couldn't determine a verdict — reject (fail-closed) but treat as "couldn't check",
      // not a content rejection: the photo may be fine and a retry often succeeds.
      console.error('[moderateChildPhoto] unparseable verdict — rejecting (fail-closed)');
      return { ok: false, category: 'unavailable', reason: 'inconclusive' };
    }
    return verdict.suitable
      ? { ok: true }
      : { ok: false, category: 'unsafe', reason: verdict.reason || 'not suitable' };
  } catch (err) {
    // Timeout / network / JSON — all reject as "couldn't check".
    console.error('[moderateChildPhoto] failed — rejecting (fail-closed):', err instanceof Error ? err.message : String(err));
    return { ok: false, category: 'unavailable', reason: 'unavailable' };
  }
}
