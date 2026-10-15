// Per-page semantic QA (QA_GATE_ENABLED, 2026-10). After a page renders structurally OK, a cheap
// vision check judges it against its scene + each present subject's reference sheet. Catches what
// the structural gate cannot: wrong-creature identity, GROSS scene/setting mismatch, and render
// hallucinations (baked borders/ruled lines, duplicated/merged limbs, baked text, indoor/outdoor
// confusion). Calibrated on the 2026-09 review: judge GROSS problems only — a character sitting
// where the text says standing is artistic latitude, not a failure (that page was better).
// Soft-fail by contract: any error → { verdict: "pass", error } so QA can never block a book.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

export const QA_MODEL = process.env.QA_GATE_MODEL || "claude-sonnet-4-6";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM = `You are a quality checker for a children's picture book. You see a rendered PAGE and, for each named character, that character's REFERENCE SHEET (the canonical look). The SHEET IMAGE is authoritative for identity. Flag a page only for GROSS, obvious problems a parent would reject — never for artistic latitude.

Flag if ANY of these is clearly true:
- IDENTITY (gross only): a character is recognisably the WRONG creature vs the sheet — wrong species, wrong breed, wrong coat TYPE (curly vs smooth), wildly different body colour, or clearly a different individual. Do NOT flag a faint/missing single marking, expression, pose, camera distance, outfit colour, or small tone shifts.
- SETTING/ACTION (gross only): the page is clearly somewhere else or doing something else than described — e.g. text says an indoor hallway but it reads as outdoors, or the described central action is absent. Do NOT flag pose or prop details (sitting vs standing, a door open vs closed, a hand position) — those are the illustrator's call.
- DEFECTS: a baked-in border/frame/box/ruled line around or across the art; duplicated/extra/mirrored limbs; merged or disconnected anatomy (a limb through a wall/door); baked-in lettering/words/numbers or an artist signature; indoor/outdoor elements fused (grass on a floor); other obvious render corruption.

NOT a defect: a large blank cream/white area reserved for the story text — a side column (left or right) or a strip along the bottom — is BY DESIGN on these page layouts. Never flag the art for not filling that reserved area.

When unsure, prefer "pass" — a false alarm wastes a redraw. Respond ONLY with JSON:
{"identity":[{"name":str,"status":"on"|"off","note":str}],"scene_match":{"status":"match"|"mismatch","note":str},"defects":[{"type":"border"|"limb_duplication"|"merged_anatomy"|"baked_text"|"setting_fusion"|"other","note":str}],"verdict":"pass"|"flag","summary":str}
verdict is "flag" iff any identity "off" OR scene_match "mismatch" OR defects non-empty.`;

const SHEET_SYSTEM = `You compare two character-sheet illustrations of what should be the SAME individual. Image 1 is the ANCHOR (authoritative). Image 2 is a CANDIDATE view minted from it. Answer whether the candidate is recognisably the same creature as the anchor.

Judge GROSS identity only: species/breed, coat or hair TYPE (curly vs smooth), and overall body/coat COLOUR (e.g. chocolate-brown vs pale golden is DIFFERENT; a slightly lighter shade of the same brown is SAME), plus build. Pose, angle, expression, framing and background are irrelevant.

Respond ONLY with JSON: {"verdict":"same"|"different","summary":str}`;

/**
 * Mint-time identity check: is a chained character-sheet view the same creature as the locked/
 * photo-anchored view-0? Catches chained-view drift (e.g. a chocolate labradoodle re-minted as
 * pale golden), which otherwise poisons every page that references that view.
 * Soft-fail: any error → "same" (never blocks a mint).
 */
export async function checkSheetIdentity({ anchorBuffer, candidateBuffer, subjectType, animalKind, timeoutMs = 45000 }) {
  const t0 = Date.now();
  const client = getClient();
  if (!client || !anchorBuffer || !candidateBuffer) return { verdict: "same", summary: "sheet qa skipped", error: "no_key_or_input", ms: 0 };
  try {
    const what = subjectType === "non_human" ? `a ${animalKind || "pet"}` : "a person";
    const resp = await client.messages.create(
      {
        model: QA_MODEL, max_tokens: 300, system: SHEET_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "text", text: `Image 1 — ANCHOR (${what}):` }, img(anchorBuffer),
          { type: "text", text: "Image 2 — CANDIDATE view:" }, img(candidateBuffer),
          { type: "text", text: "Same creature as the anchor? Reply with ONLY the JSON object." },
        ] }],
      },
      { timeout: timeoutMs },
    );
    const txt = (resp?.content ?? []).map((b) => b?.text ?? "").join("");
    const raw = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { verdict: raw.verdict === "different" ? "different" : "same", summary: raw.summary ?? "", ms: Date.now() - t0 };
  } catch (err) {
    return { verdict: "same", summary: `sheet qa skipped: ${err?.message ?? err}`, error: String(err?.message ?? err), ms: Date.now() - t0 };
  }
}

const mediaType = (buf) => (buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png");
const img = (buf) => ({ type: "image", source: { type: "base64", media_type: mediaType(buf), data: buf.toString("base64") } });

/**
 * @param {object} p
 * @param {string} p.imagePath   raw page PNG (not the composited PDF)
 * @param {object} p.scene       { page, action, narrative_text }
 * @param {Array}  p.subjects    [{ name, description, sheetPath|sheetBuffer }]
 * @param {string} [p.style]
 * @returns {Promise<{verdict:"pass"|"flag", summary:string, raw?:object, error?:string, ms:number}>}
 */
export async function checkPage({ imagePath, scene, subjects = [], style = "", timeoutMs = 45000 }) {
  const t0 = Date.now();
  const client = getClient();
  if (!client) return { verdict: "pass", summary: "qa skipped: no ANTHROPIC_API_KEY", error: "no_key", ms: 0 };
  try {
    const content = [{ type: "text", text: `RENDERED PAGE ${scene.page} (below):` }, img(fs.readFileSync(imagePath))];
    for (const s of subjects) {
      const buf = s.sheetBuffer ?? (s.sheetPath ? fs.readFileSync(s.sheetPath) : null);
      if (!buf) continue;
      content.push({ type: "text", text: `REFERENCE SHEET for "${s.name}" (below). Canonical description: ${s.description ?? ""}` });
      content.push(img(buf));
    }
    content.push({ type: "text", text: `SCENE ACTION: ${scene.action}\nPRINTED TEXT: ${scene.narrative_text}${style ? `\nART STYLE: ${style}` : ""}\n\nCheck this page per the rules and reply with ONLY the JSON object.` });
    const resp = await client.messages.create(
      { model: QA_MODEL, max_tokens: 700, system: SYSTEM, messages: [{ role: "user", content }] },
      { timeout: timeoutMs },
    );
    const txt = (resp?.content ?? []).map((b) => b?.text ?? "").join("");
    const raw = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const verdict = raw.verdict === "flag" ? "flag" : "pass";
    return { verdict, summary: raw.summary ?? "", raw, ms: Date.now() - t0 };
  } catch (err) {
    return { verdict: "pass", summary: `qa skipped: ${err?.message ?? err}`, error: String(err?.message ?? err), ms: Date.now() - t0 };
  }
}
