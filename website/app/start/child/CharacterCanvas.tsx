'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { resolveLayers, type BuilderManifest, type ResolvedLayer, type Selections } from '@/lib/builder/resolve';

const MANIFEST_URL = '/builder/watercolor/manifest.json';
const ASSET_BASE = '/builder/watercolor';

// The watercolour layer assets are cut out from paper, so each carries a ~3-5px
// fringe of the original PAPER colour at its silhouette edge (soft paint-into-paper
// blend; no clean alpha). They MUST be displayed on this paper colour (or be
// decontaminated first) — on any other background the fringe reads as a seam ring
// around the figure. The preview is therefore framed as a deliberate "paper card"
// in this colour rather than the (pinker) page cream. See docs/compositing-builder-design.md §8.
const PAPER = '#fdfbef';

export interface CharacterCanvasHandle {
  /** The composited character as a PNG blob (for Stage C: the pipeline anchor). */
  toBlob: () => Promise<Blob | null>;
}

interface CharacterCanvasProps {
  selections: Selections;
  /** Test/SSR override — skips the manifest fetch when provided. */
  manifest?: BuilderManifest;
  /** Fired whenever the resolved layer stack changes (data-driven hook for tests). */
  onResolve?: (layers: ResolvedLayer[]) => void;
  className?: string;
}

function describe(s: Selections): string {
  const bits = [s.hair_colour, s.hair_style && `${s.hair_style} hair`, s.eye_colour && `${s.eye_colour} eyes`,
    s.glasses === 'yes' && 'glasses'].filter(Boolean);
  return bits.length ? `Your character: a ${s.gender ?? 'child'} with ${bits.join(', ')}.` : 'Your character preview.';
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // missing asset (e.g. bald) -> skip, show layers beneath
    img.src = url;
  });

/**
 * The live compositing canvas — the Mii-style centrepiece. Reads the data-driven
 * manifest, resolves the ordered layer stack from the current wizard selections,
 * and paints transparent watercolour layers low z -> high. Reactive + instant +
 * free. Exposes toBlob() for the (gated) Stage-C pipeline anchor.
 */
export const CharacterCanvas = forwardRef<CharacterCanvasHandle, CharacterCanvasProps>(function CharacterCanvas(
  { selections, manifest: manifestProp, onResolve, className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<BuilderManifest | null>(manifestProp ?? null);

  useImperativeHandle(ref, () => ({
    toBlob: () =>
      new Promise<Blob | null>((resolve) => {
        const c = canvasRef.current;
        if (!c || typeof c.toBlob !== 'function') return resolve(null);
        c.toBlob((b) => resolve(b), 'image/png');
      }),
  }));

  // Fetch the manifest once (unless injected).
  useEffect(() => {
    if (manifestProp) {
      setManifest(manifestProp);
      return;
    }
    let live = true;
    fetch(MANIFEST_URL)
      .then((r) => r.json())
      .then((m: BuilderManifest) => {
        if (live) setManifest(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [manifestProp]);

  // Resolve + paint whenever the manifest or selections change.
  useEffect(() => {
    if (!manifest) return;
    const layers = resolveLayers(manifest, selections, ASSET_BASE);
    onResolve?.(layers);

    let cancelled = false;
    (async () => {
      const imgs = await Promise.all(layers.map((l) => loadImage(l.url)));
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext?.('2d');
      if (!canvas || !ctx) return; // jsdom / unsupported -> resolution still ran
      const base = imgs.find((i) => i && i.naturalWidth) || imgs.find(Boolean);
      if (base) {
        canvas.width = base.naturalWidth;
        canvas.height = base.naturalHeight;
      }
      // Fill the bitmap with the paper colour BEFORE drawing layers (rather than
      // relying on the CSS background showing through transparency): makes the output
      // background-independent and gives toBlob() an opaque paper-backed image. The
      // layer assets' paper-colour edge fringe blends into this fill, same as the
      // proven PIL composite.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const img of imgs) {
        if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifest, selections, onResolve]);

  return (
    // Paper card — the warm border + soft shadow make the paper-colour background
    // (lighter than the page cream) read as an intentional frame, not a mismatch.
    <div
      // Paper bg + soft shadow via inline style: this project's Tailwind theme doesn't
      // configure the shadow scale (named AND arbitrary shadow utilities render nothing,
      // since v4 box-shadow composes through ring vars that aren't initialised here).
      // Radius via the named scale is fine (rounded-2xl = 16px).
      className={`border-warm-grey-light p-sm rounded-2xl border ${className ?? ''}`}
      style={{ backgroundColor: PAPER, boxShadow: '0 2px 14px rgba(120, 90, 60, 0.10)' }}
      role="img"
      aria-label={describe(selections)}
    >
      <canvas
        ref={canvasRef}
        className="aspect-[11/6] w-full rounded-xl"
        style={{ backgroundColor: PAPER }}
        data-testid="character-canvas"
      />
      <span className="sr-only">{describe(selections)}</span>
    </div>
  );
});
