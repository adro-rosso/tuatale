/**
 * Library completeness (Spec: compositing builder, Stage B). Every style × colour ×
 * gender the manifest advertises must resolve to a real asset on disk — otherwise
 * the live builder would silently fall back to a placeholder for some selections.
 * Reads the SHIPPED manifest + assets under public/builder/watercolor.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'public', 'builder', 'watercolor');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const has = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const GENDERS = ['boy', 'girl'] as const;
const { hair_colour: COLOURS, eye_colour: EYE, hair_style: STYLES } = manifest.values;

describe('compositing library completeness', () => {
  it('has both bald bases and glasses layers', () => {
    for (const g of GENDERS) {
      expect(has(`base/${g}.webp`), `base/${g}`).toBe(true);
      expect(has(`glasses/${g}.webp`), `glasses/${g}`).toBe(true);
    }
  });

  it('has every eye-colour overlay per gender', () => {
    const missing: string[] = [];
    for (const g of GENDERS) for (const c of EYE) if (!has(`eye/${g}/${c}.webp`)) missing.push(`eye/${g}/${c}`);
    expect(missing).toEqual([]);
  });

  it('has a front layer for every style × colour × gender (bald excepted)', () => {
    const missing: string[] = [];
    for (const g of GENDERS) {
      for (const style of STYLES[g] as string[]) {
        if (style === 'bald') continue; // bald = no hair layer, the base shows
        for (const c of COLOURS) {
          if (!has(`hair/${g}/${style}-front-${c}.webp`)) missing.push(`hair/${g}/${style}-front-${c}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every manifest layer template references an axis the wizard provides', () => {
    const known = new Set(['gender', 'hair_style', 'hair_colour', 'eye_colour', 'glasses']);
    for (const layer of manifest.layers) {
      const tokens = [...layer.asset.matchAll(/\{(\w+)\}/g)].map((m: RegExpMatchArray) => m[1] as string);
      for (const t of tokens) expect(known.has(t), `${layer.id} token ${t}`).toBe(true);
    }
  });
});
