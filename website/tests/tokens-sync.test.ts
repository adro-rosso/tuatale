/**
 * Token sync guard.
 *
 * Tailwind v4's @theme block in app/globals.css IS the source of truth for
 * Tailwind's utility generation. lib/tokens.ts mirrors those values for
 * JS-context use (Sentry tags, future dynamic styling, brand metadata).
 *
 * This test parses the @theme block as plain text and asserts each
 * mirrored value matches lib/tokens.ts exactly. If you edit one side,
 * this test fails until you edit the other.
 *
 * The test is intentionally simple — text-level parsing rather than a
 * CSS AST. We pay one false negative per token-shape change (e.g. if we
 * later add tokens to tokens.ts that aren't mirrored to CSS, the test
 * needs to know whether that's intentional). Today: every tokens.colors,
 * tokens.fontSize, tokens.lineHeight, tokens.letterSpacing, tokens.spacing,
 * tokens.breakpoints entry MUST appear in @theme.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { tokens } from '@/lib/tokens';

const globalsCss = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

// Extract the @theme { ... } block (the first one — we only have one).
const themeMatch = globalsCss.match(/@theme\s*\{([\s\S]*?)\n\}/);
if (!themeMatch || !themeMatch[1]) {
  throw new Error('@theme block not found in app/globals.css — tokens-sync test cannot run.');
}
const themeBlock = themeMatch[1];

// Parse `--name: value;` lines into a map (strip comments + whitespace).
function parseThemeVars(block: string): Map<string, string> {
  const vars = new Map<string, string>();
  const lines = block.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\*.*?\*\//g, '').trim();
    const match = line.match(/^--([a-z0-9-]+)\s*:\s*([^;]+);?$/i);
    if (match && match[1] && match[2]) {
      vars.set(match[1], match[2].trim());
    }
  }
  return vars;
}

// kebab-case helper for token keys like `creamDeep` → `cream-deep`.
function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

const themeVars = parseThemeVars(themeBlock);

describe('tokens.ts ↔ globals.css @theme block', () => {
  it('parses the @theme block successfully', () => {
    expect(themeVars.size).toBeGreaterThan(0);
  });

  it('every tokens.colors entry is mirrored as --color-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.colors)) {
      const cssVar = `color-${kebab(name)}`;
      expect(themeVars.get(cssVar)?.toLowerCase()).toBe(value.toLowerCase());
    }
  });

  it('every tokens.fontSize entry is mirrored as --text-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.fontSize)) {
      const cssVar = `text-${name}`;
      expect(themeVars.get(cssVar)).toBe(value);
    }
  });

  it('every tokens.lineHeight entry is mirrored as --leading-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.lineHeight)) {
      expect(themeVars.get(`leading-${name}`)).toBe(value);
    }
  });

  it('every tokens.letterSpacing entry is mirrored as --tracking-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.letterSpacing)) {
      expect(themeVars.get(`tracking-${name}`)).toBe(value);
    }
  });

  it('every tokens.spacing entry is mirrored as --spacing-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.spacing)) {
      expect(themeVars.get(`spacing-${name}`)).toBe(value);
    }
  });

  it('every tokens.breakpoints entry (except mobile) is mirrored as --breakpoint-*', () => {
    for (const [name, value] of Object.entries(tokens.breakpoints)) {
      if (name === 'mobile') continue; // mobile is implicit (0px); no CSS var
      expect(themeVars.get(`breakpoint-${name}`)).toBe(value);
    }
  });

  it('every tokens.fonts entry is mirrored as --font-* in @theme', () => {
    for (const [name, value] of Object.entries(tokens.fonts)) {
      expect(themeVars.get(`font-${name}`)).toBe(value);
    }
  });
});
