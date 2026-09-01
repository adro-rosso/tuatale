'use server';

/**
 * "Go deeper" — an OPTIONAL story-enrichment interview on the theme step. Reads what the
 * customer has written so far (plus light context) and returns 3-5 short, tailored questions
 * whose answers would make the finished book more personal. It does NOT rewrite their story
 * (that's improveStory); the caller appends the answered Q&A beneath their own text.
 *
 * Same server-side guarantees as improveStory:
 *   - SERVER-SIDE ONLY. ANTHROPIC_API_KEY never reaches the browser.
 *   - FLAG-GATED (STORY_PROBE_ENABLED, server-only, fail-closed): off → { ok:false,
 *     reason:'disabled' }, so a stale client that still shows the button can't invoke it.
 *   - SOFT-FAIL, never throws: no key / LLM / parse / timeout all return { ok:false }, so the
 *     theme step never crashes and the customer keeps whatever they typed.
 *   - Light per-draft/day abuse cap (in-memory; bounds spend without a migration).
 *
 * Direct fetch to the Anthropic Messages API (no SDK). Haiku 4.5 — cheap + fast; asking a
 * handful of good questions doesn't need a frontier model.
 */
import { getDraftCookieFromRequest } from '@/lib/draft-cookie';

export interface ProbeStoryInput {
  /** The customer's current story text (may be empty). */
  text: string;
  bookType: string;
  heroName?: string | null;
  age?: number | null;
  gender?: string | null;
  themeLabel?: string | null;
  vibe?: string | null;
}

export type ProbeStoryReason = 'disabled' | 'no_key' | 'rate_limited' | 'llm_error' | 'bad_response' | 'empty';

export interface ProbeStoryResult {
  ok: boolean;
  /** 3-5 short follow-up questions (present only on ok:true). */
  questions?: string[];
  reason?: ProbeStoryReason;
}

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 512;
const REQUEST_TIMEOUT_MS = 20_000;

const INPUT_CHAR_LIMIT = 2000;
const QUESTION_CHAR_LIMIT = 140; // ~a 15-word question; a server-side safety net on length
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;

// ---- Light per-draft/day abuse cap (in-memory, per serverless instance) --------------
const DAILY_CAP = 40;
const BURST_MS = 3_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const probeLog = new Map<string, number[]>();

function underAbuseCap(key: string): boolean {
  const now = Date.now();
  const recent = (probeLog.get(key) ?? []).filter((t) => now - t < DAY_MS);
  if (recent.length >= DAILY_CAP) {
    probeLog.set(key, recent);
    return false;
  }
  if (recent.length > 0 && now - recent[recent.length - 1]! < BURST_MS) {
    probeLog.set(key, recent);
    return false;
  }
  recent.push(now);
  probeLog.set(key, recent);
  return true;
}

function bookTypeLabel(bookType: string): string {
  if (bookType === 'pet') return "a personalised children's picture book starring the family pet";
  if (bookType === 'adult') return 'a personalised illustrated storybook for an adult (a gift)';
  return "a personalised children's picture book";
}

const SYSTEM_PROMPT = `You help a parent add richer, more personal detail to a story for a personalised picture book. You'll get what they've written so far plus a little context. Do NOT rewrite their story. Instead, ask 3 to 5 short, warm, specific questions whose answers would make the finished book more personal, vivid, and true to their child.

Aim for the details a great writer or illustrator would want but that are easy and delightful for a parent to answer: a specific moment or feeling, a favourite object or outfit, a small habit or saying, who else matters in the scene, where it happens, a sensory detail (a sound, a smell, the weather, a time of day).

Rules:
- Prefer questions grounded in what they ALREADY wrote over generic ones. Skip anything they have already told you.
- Each question MUST be a single sentence UNDER 15 words. Count the words. If a question would run longer, make it shorter or ask a simpler version. Do NOT use "or" to cram two questions into one.
- Plain, warm British English. No em dashes. No preamble.
- Gentle and appropriate for a young child throughout. No violence, romance, or frightening content.
- If they have written almost nothing, ask the foundational questions that would let us build the story, without inventing specifics you were not told.

Respond with ONLY a JSON object and nothing else, in exactly this shape:
{"questions": ["<question>", "<question>", "<question>"]}
Return between 3 and 5 questions.`;

function buildUserMessage(input: ProbeStoryInput): string {
  const text = input.text.trim().slice(0, INPUT_CHAR_LIMIT);
  return [
    `Book: ${bookTypeLabel(input.bookType)}`,
    `Hero's name: ${input.heroName?.trim() || 'not given'}`,
    `Age: ${input.age != null ? String(input.age) : 'not given'}`,
    `Gender: ${input.gender?.trim() || 'not given'}`,
    `Chosen theme: ${input.themeLabel?.trim() || 'none chosen'}`,
    `Mood: ${input.vibe?.trim() || 'not set'}`,
    '',
    'What they wrote so far:',
    '"""',
    text || '(they have not written anything yet)',
    '"""',
  ].join('\n');
}

function parseQuestions(raw: string): string[] | null {
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
  if (!Array.isArray(obj.questions)) return null;
  const questions = obj.questions
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim().slice(0, QUESTION_CHAR_LIMIT))
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);
  return questions;
}

/**
 * Ask 3-5 enrichment questions. NEVER throws; inert without the flag or key. Returns
 * { ok:false } on any failure so the theme step keeps working and the customer keeps
 * their text.
 */
export async function probeStory(input: ProbeStoryInput): Promise<ProbeStoryResult> {
  if (process.env.STORY_PROBE_ENABLED !== 'on') {
    return { ok: false, reason: 'disabled' };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[probeStory] ANTHROPIC_API_KEY absent in this environment — check the Vercel env scope.');
    return { ok: false, reason: 'no_key' };
  }

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
      const errBody = await res.text().catch(() => '');
      console.error(`[probeStory] Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
      return { ok: false, reason: 'llm_error' };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const rawText = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const questions = parseQuestions(rawText);
    if (!questions) return { ok: false, reason: 'bad_response' };
    if (questions.length < MIN_QUESTIONS) return { ok: false, reason: 'empty' };

    return { ok: true, questions };
  } catch (err) {
    console.error('[probeStory] soft-fail:', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'llm_error' };
  }
}
