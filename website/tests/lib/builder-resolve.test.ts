/**
 * resolveLayers — the data-driven layer-stack core (Spec: compositing builder,
 * Stage B). Pure ordering + token-filling + driver-gating, no canvas.
 */
import { describe, it, expect } from 'vitest';
import { resolveLayers, type BuilderManifest } from '@/lib/builder/resolve';

const MANIFEST: BuilderManifest = {
  style: 'watercolor',
  layers: [
    { id: 'hair-back', z: 10, kind: 'overlay', driver: 'hair_style', recolour: 'hair_colour', asset: 'hair/{gender}/{hair_style}-back-{hair_colour}.webp' },
    { id: 'base', z: 20, kind: 'base', asset: 'base/{gender}.webp' },
    { id: 'eye', z: 30, kind: 'overlay', driver: 'eye_colour', asset: 'eye/{gender}/{eye_colour}.webp' },
    { id: 'hair-front', z: 40, kind: 'overlay', driver: 'hair_style', recolour: 'hair_colour', asset: 'hair/{gender}/{hair_style}-front-{hair_colour}.webp' },
    { id: 'glasses', z: 50, kind: 'overlay', driver: 'glasses', asset: 'glasses/{gender}.webp' },
  ],
};

describe('resolveLayers', () => {
  it('paints in z-order and fills tokens from selections', () => {
    const out = resolveLayers(MANIFEST, {
      gender: 'girl', hair_style: 'long', hair_colour: 'black', eye_colour: 'green', glasses: 'yes',
    });
    expect(out.map((l) => l.id)).toEqual(['hair-back', 'base', 'eye', 'hair-front', 'glasses']);
    expect(out.find((l) => l.id === 'hair-front')!.url).toBe('/builder/watercolor/hair/girl/long-front-black.webp');
    expect(out.find((l) => l.id === 'base')!.url).toBe('/builder/watercolor/base/girl.webp');
  });

  it('hides a driver layer whose selection is a hidden value (glasses=no)', () => {
    const out = resolveLayers(MANIFEST, { gender: 'boy', hair_style: 'tousled', hair_colour: 'brown', eye_colour: 'brown', glasses: 'no' });
    expect(out.map((l) => l.id)).not.toContain('glasses');
  });

  it('skips a layer when a required token has no selection', () => {
    const out = resolveLayers(MANIFEST, { gender: 'girl', glasses: 'no' }); // no hair/eye picked
    expect(out.map((l) => l.id)).toEqual(['base']); // only the base resolves
  });

  it('respects a custom asset base', () => {
    const out = resolveLayers(MANIFEST, { gender: 'boy' }, 'https://cdn/x');
    expect(out.find((l) => l.id === 'base')!.url).toBe('https://cdn/x/base/boy.webp');
  });
});
