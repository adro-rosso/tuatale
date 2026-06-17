/**
 * Data-driven layer resolution for the compositing character builder.
 *
 * The manifest (public/builder/watercolor/manifest.json) is a generic ORDERED
 * layer stack. This pure function turns a set of wizard selections into the
 * ordered list of asset URLs to paint (low z -> high). Keeping it pure makes the
 * compositor's core behaviour unit-testable without a canvas.
 *
 * A layer is INCLUDED when:
 *   - every `{token}` in its asset path has a non-empty selection, AND
 *   - if it has a `driver`, that driver's selection is not a "hidden" value
 *     (so glasses="no" hides the glasses layer; an unpicked axis hides its layer).
 * A style with no matching asset file (e.g. "bald") still resolves a URL but the
 * canvas skips it on load error — which correctly shows the bald base.
 */
export interface LayerDef {
  id: string;
  z: number;
  kind: 'base' | 'overlay';
  driver?: string;
  recolour?: string;
  asset: string;
}

export interface BuilderManifest {
  style: string;
  layers: LayerDef[];
  values?: Record<string, unknown>;
}

export type Selections = Record<string, string | undefined>;

export interface ResolvedLayer {
  id: string;
  url: string;
}

const HIDDEN = new Set(['', 'no', 'none', undefined]);

export function resolveLayers(
  manifest: BuilderManifest,
  selections: Selections,
  assetBase = '/builder/watercolor',
): ResolvedLayer[] {
  return [...manifest.layers]
    .sort((a, b) => a.z - b.z)
    .map((layer): ResolvedLayer | null => {
      if (layer.driver && HIDDEN.has(selections[layer.driver])) return null;
      let complete = true;
      const path = layer.asset.replace(/\{(\w+)\}/g, (_, key: string) => {
        const v = selections[key];
        if (v === undefined || v === '') {
          complete = false;
          return '';
        }
        return v;
      });
      return complete ? { id: layer.id, url: `${assetBase}/${path}` } : null;
    })
    .filter((l): l is ResolvedLayer => l !== null);
}
