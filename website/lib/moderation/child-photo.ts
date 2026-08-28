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

const SYSTEM_PROMPT = `You are a content-safety reviewer for a children's picture-book service. A parent uploads a photo to have their child illustrated as a storybook character. Decide whether the photo is SUITABLE to accept.

SUITABLE (suitable: true) — an ordinary, appropriate photo of a person or people (typically a child) that could reasonably be used as a likeness reference: a normal portrait or snapshot, clothed, non-explicit, non-violent.

NOT SUITABLE (suitable: false) — ANY of:
- sexual, nude, or otherwise explicit content;
- violence, gore, weapons used threateningly, or other distressing/unsafe content;
- the image is not a genuine photo of a person (a document, screenshot, meme, drawing, logo, or an unrelated object/scene with no person);
- anything else you would not want a children's-book service to store or process.

Be conservative: if you are unsure, choose suitable: false.

Respond with ONLY a JSON object, nothing else:
{"suitable": true|false, "reason": "<short reason>"}`;

export type ModerationResult = { ok: true } | { ok: false; reason: string };

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
    return { ok: false, reason: 'unavailable' };
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
      return { ok: false, reason: 'error' };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const rawText = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const verdict = parseVerdict(rawText);
    if (!verdict) {
      console.error('[moderateChildPhoto] unparseable verdict — rejecting (fail-closed)');
      return { ok: false, reason: 'inconclusive' };
    }
    return verdict.suitable ? { ok: true } : { ok: false, reason: verdict.reason || 'not suitable' };
  } catch (err) {
    // Timeout / network / JSON — all reject.
    console.error('[moderateChildPhoto] failed — rejecting (fail-closed):', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'unavailable' };
  }
}
