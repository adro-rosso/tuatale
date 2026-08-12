/**
 * Cover-title derivation for the pre-purchase "see a glimpse" cover (Batch 4a).
 *
 * Pure + $0 — NO LLM. There's no story-generated title pre-purchase, so we derive a
 * warm, cover-worthy title from the hero's name + the chosen theme:
 *   - Preset theme  → the template's own title (already a good short title), with a
 *                     "for <name>" subline (mirrors the printed cover's title + subline).
 *   - Custom / none → a warm "<Name>'s <word>" fallback (the theme has no title to reuse),
 *                     with the name IN the title, so no redundant subline.
 *
 * Mirrors the printed cover typography split (Fredoka title + "for <name>"); the Haiku
 * short-title upgrade is deliberately NOT wired here in v1.
 */
import { THEMES, PET_THEMES, ADULT_THEMES, CUSTOM_TEMPLATE_ID } from '@/lib/themes';

export interface CoverTitle {
  /** The cover title (Fredoka, balanced onto ≤2 lines by balanceTitleLines). */
  title: string;
  /** "for <name>" subline, or null when the name is already in the title / absent. */
  subtitle: string | null;
}

// id → title across all theme sets (presets carry a ready-made short title).
const TITLE_BY_ID: Record<string, string> = Object.fromEntries(
  [...THEMES, ...PET_THEMES, ...ADULT_THEMES].map((t) => [t.id, t.title]),
);

// Warm generic word for the custom/no-preset fallback — never a bland "[Name]'s Story"
// for children; kept short so it reads as a title.
function warmWord(bookType: string): string {
  if (bookType === 'pet') return 'Tale';
  if (bookType === 'adult') return 'Story';
  return 'Big Adventure';
}
function noNameWord(bookType: string): string {
  if (bookType === 'pet') return 'Tale';
  if (bookType === 'adult') return 'Story';
  return 'Adventure';
}

export function deriveCoverTitle(input: {
  childName?: string | null;
  bookType?: string | null;
  themeTemplateId?: string | null;
}): CoverTitle {
  const name = (input.childName ?? '').trim();
  const bookType = input.bookType ?? 'child';
  const presetId = input.themeTemplateId;

  // Preset theme → reuse its title, with the name on the subline (printed-cover shape).
  if (presetId && presetId !== CUSTOM_TEMPLATE_ID && TITLE_BY_ID[presetId]) {
    return { title: TITLE_BY_ID[presetId], subtitle: name ? `for ${name}` : null };
  }

  // Custom story / no preset → warm fallback. Name in the title → no subline.
  if (name) {
    return { title: `${name}'s ${warmWord(bookType)}`, subtitle: null };
  }
  return { title: `A Little ${noNameWord(bookType)}`, subtitle: null };
}

/**
 * Balance a title onto ≤2 lines at the word boundary that minimises the two lines'
 * length difference (avoids an orphan trailing word). ≤3 words stay on one line.
 * Ported from src/front-matter.js so the web overlay wraps like the printed cover.
 */
export function balanceTitleLines(title: string): string[] {
  const words = String(title ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return [words.join(' ')];
  let best = { i: 1, diff: Infinity };
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    const diff = Math.abs(left.length - right.length);
    if (diff < best.diff) best = { i, diff };
  }
  return [words.slice(0, best.i).join(' '), words.slice(best.i).join(' ')];
}
