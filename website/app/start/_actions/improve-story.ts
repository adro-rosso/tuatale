'use server';

/**
 * "Help me write this" — AI-assist for the STORY field on the theme step (Batch 3, v1).
 *
 * One-click: takes the parent's rough story idea and returns (a) a tidied, expanded
 * story brief FAITHFUL to what they wrote, and (b) 1–2 short optional questions whose
 * answers would make the book more personal. The result is a SUGGESTION — the caller
 * fills the editable textarea with it (or keeps their own); nothing is auto-overwritten.
 *
 * Design constraints (all enforced here, server-side):
 *   - SERVER-SIDE ONLY. ANTHROPIC_API_KEY must never reach the browser (no NEXT_PUBLIC).
 *   - INERT / SOFT-FAIL without the key: no key → { ok:false, reason:'no_key' }, never a
 *     throw. Any LLM/parse/timeout failure returns { ok:false } too, so the theme step
 *     never crashes and the customer keeps whatever they already typed.
 *   - Hard 2000-char cap on the returned brief (matches the textarea maxLength), applied
 *     server-side regardless of what the model returns.
 *   - Light per-draft/day abuse cap (in-memory; bounds spend without a migration).
 *
 * Uses a direct fetch to the Anthropic Messages API (no SDK dependency — Node has global
 * fetch). Haiku 4.5 is the model: cheap, fast, plenty for a rewrite-and-suggest task.
 */
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';

export interface ImproveStoryInput {
  /** The parent's current story text (may be empty). */
  text: string;
  /** 'child' | 'pet' | 'adult' — shapes the brief's framing. */
  bookType: string;
  /** The hero's name, if known, for a more personal brief. */
  heroName?: string | null;
  /** The chosen theme/template title, if any (e.g. "First day of school"). */
  themeLabel?: string | null;
  /** The chosen mood/vibe, if any (pet + adult books). */
  vibe?: string | null;
}

export type ImproveStoryReason = 'no_key' | 'rate_limited' | 'llm_error' | 'bad_response' | 'empty';

export interface ImproveStoryResult {
  ok: boolean;
  /** The rewritten brief (present only on ok:true). Already ≤ STORY_CHAR_LIMIT chars. */
  improvedText?: string;
  /** 0–2 short optional follow-up questions (present only on ok:true). */
  questions?: string[];
  /** Why it soft-failed (present only on ok:false). */
  reason?: ImproveStoryReason;
}

// Haiku 4.5 — the exact dated model ID (pinned rather than the `claude-haiku-4-5` alias,
// so the model string is deterministic and never resolves differently). Cheap + fast; a
// rewrite-and-suggest task doesn't need a frontier model.
const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 20_000; // never let the theme step hang on a stalled call

// Hard cap on the returned brief — mirrors the textarea's maxLength={2000}. Applied
// server-side so a runaway model response can never exceed it.
const STORY_CHAR_LIMIT = 2000;
// Cap the incoming text we send (defends the prompt even if the client bypasses maxLength).
const INPUT_CHAR_LIMIT = 2000;
const MAX_QUESTIONS = 2;
const QUESTION_CHAR_LIMIT = 200;

// ---- Light per-draft/day abuse cap ---------------------------------------------------
// In-memory (per serverless instance) — deliberately lightweight: it bounds obvious
// abuse/spend without a DB migration. Haiku calls are ~fractions of a cent, so this is a
// courtesy guard, not a billing control. Keyed by the caller's draft cookie.
const DAILY_CAP = 40; // assists per draft per rolling 24h
const BURST_MS = 3_000; // min gap between assists (debounce double-clicks / scripts)
const DAY_MS = 24 * 60 * 60 * 1000;
const assistLog = new Map<string, number[]>();

function underAbuseCap(key: string): boolean {
  const now = Date.now();
  const recent = (assistLog.get(key) ?? []).filter((t) => now - t < DAY_MS);
  if (recent.length >= DAILY_CAP) {
    assistLog.set(key, recent);
    return false;
  }
  if (recent.length > 0 && now - recent[recent.length - 1]! < BURST_MS) {
    assistLog.set(key, recent);
    return false;
  }
  recent.push(now);
  assistLog.set(key, recent);
  return true;
}

function bookTypeLabel(bookType: string): string {
  if (bookType === 'pet') return "a personalised children's picture book starring the family pet";
  if (bookType === 'adult') return 'a personalised illustrated storybook for an adult (a gift)';
  return "a personalised children's picture book";
}

const SYSTEM_PROMPT = `You help someone describe the story for a personalised picture book. You'll get the rough story idea they typed plus a little context. Do two things:

1. Rewrite their idea into a clear, warm story brief of 2–6 sentences that our writers and illustrators can work from. Stay FAITHFUL to what they wrote — same characters, same events, same intent. Expand and tidy their wording; do NOT invent a different plot or add major new events, people, or places they didn't mention. If a detail is missing, leave it out rather than making one up.
2. Suggest 1–2 short, friendly questions whose answers would make the book more personal (for example: "Where does the adventure take place?"). Keep each question under 15 words. If there's nothing useful to ask, return an empty list.

Rules:
- Keep everything gentle, warm, and appropriate for a young child. No violence, romance, frightening content, or anything unsuitable for a children's book.
- If they wrote almost nothing, offer a soft, generic starter brief they can build on — do NOT fabricate specific personal details (real events, relatives, places) you weren't told.
- Write in plain, warm British English. No em dashes. No preamble.

Respond with ONLY a JSON object and nothing else, in exactly this shape:
{"improvedText": "<the rewritten brief>", "questions": ["<question>", "<question>"]}
Keep improvedText under 2000 characters.`;

function buildUserMessage(input: ImproveStoryInput): string {
  const text = input.text.trim().slice(0, INPUT_CHAR_LIMIT);
  const lines = [
    `Book: ${bookTypeLabel(input.bookType)}`,
    `Hero's name: ${input.heroName?.trim() || 'not given'}`,
    `Chosen theme: ${input.themeLabel?.trim() || 'none chosen'}`,
    `Mood: ${input.vibe?.trim() || 'not set'}`,
    '',
    'What they wrote:',
    '"""',
    text || '(they have not written anything yet)',
    '"""',
  ];
  return lines.join('\n');
}

/** Pull the first {...} JSON object out of the model text and validate its shape. */
function parseModelJson(raw: string): { improvedText: string; questions: string[] } | null {
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
  const improvedRaw = typeof obj.improvedText === 'string' ? obj.improvedText.trim() : '';
  if (!improvedRaw) return null;
  const questions = Array.isArray(obj.questions)
    ? obj.questions
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim().slice(0, QUESTION_CHAR_LIMIT))
        .filter(Boolean)
        .slice(0, MAX_QUESTIONS)
    : [];
  // Hard server-side cap — never return more than the textarea can hold.
  return { improvedText: improvedRaw.slice(0, STORY_CHAR_LIMIT), questions };
}

/**
 * Improve the story text. NEVER throws — every failure path returns { ok:false } so the
 * caller can keep the customer's own text and carry on. Inert without the API key.
 */
export async function improveStory(input: ImproveStoryInput): Promise<ImproveStoryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Diagnosable in `vercel logs`: the commonest cause is the key existing in one Vercel
    // environment scope (e.g. Production) but not the one this deployment runs in (Preview).
    // Never logs the key — it isn't present here to log.
    console.error('[improveStory] ANTHROPIC_API_KEY absent in this environment — check the Vercel env scope (Production vs Preview vs Development).');
    return { ok: false, reason: 'no_key' };
  }

  // Abuse cap, keyed by the caller's own draft cookie (a shared bucket if somehow absent).
  let cookieId: string | null = null;
  try {
    cookieId = await getDraftCookieFromRequest();
  } catch {
    cookieId = null;
  }
  if (!underAbuseCap(cookieId ?? 'no-cookie')) {
    return { ok: false, reason: 'rate_limited' };
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
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Log the status + Anthropic's error body (error type/message) so a 401 (bad key),
      // 404 (bad model), or 429 (rate limit) is distinguishable in `vercel logs`. Anthropic
      // error bodies never echo the request's API key, so this is safe to log.
      const errBody = await res.text().catch(() => '');
      console.error(`[improveStory] Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
      return { ok: false, reason: 'llm_error' };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const rawText = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const parsed = parseModelJson(rawText);
    if (!parsed) return { ok: false, reason: 'bad_response' };

    return { ok: true, improvedText: parsed.improvedText, questions: parsed.questions };
  } catch (err) {
    // Timeouts (AbortError), network errors, JSON errors — all soft-fail.
    console.error('[improveStory] soft-fail:', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'llm_error' };
  }
}
