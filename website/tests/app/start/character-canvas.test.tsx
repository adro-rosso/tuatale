/**
 * CharacterCanvas — the live compositing centrepiece (Spec: compositing builder,
 * Stage B). Data-driven: renders from the manifest, reacts to selection changes,
 * and exposes the composite as a blob (the Stage-C pipeline anchor).
 *
 * jsdom has no real 2D canvas, so these tests drive the resolution path (onResolve)
 * and the toBlob wiring (canvas.toBlob mocked) rather than pixel output.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { CharacterCanvas, type CharacterCanvasHandle } from '@/app/start/child/CharacterCanvas';
import type { BuilderManifest, ResolvedLayer } from '@/lib/builder/resolve';

const MANIFEST: BuilderManifest = {
  style: 'watercolor',
  layers: [
    { id: 'hair-back', z: 10, kind: 'overlay', driver: 'hair_style', asset: 'hair/{gender}/{hair_style}-back-{hair_colour}.webp' },
    { id: 'base', z: 20, kind: 'base', asset: 'base/{gender}.webp' },
    { id: 'hair-front', z: 40, kind: 'overlay', driver: 'hair_style', asset: 'hair/{gender}/{hair_style}-front-{hair_colour}.webp' },
    { id: 'glasses', z: 50, kind: 'overlay', driver: 'glasses', asset: 'glasses/{gender}.webp' },
  ],
};

describe('CharacterCanvas', () => {
  it('renders the layer stack from the manifest for the current selections', async () => {
    const onResolve = vi.fn();
    render(
      <CharacterCanvas
        manifest={MANIFEST}
        onResolve={onResolve}
        selections={{ gender: 'girl', hair_style: 'long', hair_colour: 'black', glasses: 'no' }}
      />,
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    const layers: ResolvedLayer[] = onResolve.mock.calls.at(-1)![0];
    expect(layers.map((l) => l.id)).toEqual(['hair-back', 'base', 'hair-front']); // glasses=no hidden
    expect(layers.find((l) => l.id === 'hair-front')!.url).toContain('long-front-black.webp');
  });

  it('reacts to a selection change (recolour swaps the resolved asset)', async () => {
    const onResolve = vi.fn();
    const { rerender } = render(
      <CharacterCanvas manifest={MANIFEST} onResolve={onResolve} selections={{ gender: 'girl', hair_style: 'long', hair_colour: 'black' }} />,
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    rerender(
      <CharacterCanvas manifest={MANIFEST} onResolve={onResolve} selections={{ gender: 'girl', hair_style: 'long', hair_colour: 'blonde' }} />,
    );
    await waitFor(() => {
      const layers: ResolvedLayer[] = onResolve.mock.calls.at(-1)![0];
      expect(layers.find((l) => l.id === 'hair-front')!.url).toContain('long-front-blonde.webp');
    });
  });

  it('fetches the manifest when none is injected', async () => {
    const onResolve = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve(MANIFEST),
    } as Response);
    render(<CharacterCanvas onResolve={onResolve} selections={{ gender: 'boy', hair_style: 'tousled', hair_colour: 'brown' }} />);
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith('/builder/watercolor/manifest.json');
    fetchSpy.mockRestore();
  });

  it('exposes the composite as a blob (Stage-C anchor)', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(blob);
    });
    const ref = createRef<CharacterCanvasHandle>();
    render(<CharacterCanvas ref={ref} manifest={MANIFEST} selections={{ gender: 'girl', hair_style: 'long', hair_colour: 'black' }} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.toBlob()).resolves.toBe(blob);
  });
});
