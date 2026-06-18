// src/image-bg.js — sample a generated image's BACKGROUND colour so a display box
// can match it (the character then melts into its box; no seam against page cream).
//
// Server-side (the worker has the PNG buffer) → avoids the browser's cross-origin
// tainted-canvas problem entirely. Samples the FOUR corners (small patches, each
// averaged to one pixel) and takes the per-channel MEDIAN across them — robust to a
// corner that happens to hold the character or a dark element. Watercolour bgs are
// opaque paper, so alpha is dropped. Returns "#rrggbb" or null on any failure
// (caller treats null as "no override → keep the default box colour").

import sharp from "sharp";

export async function sampleBackgroundColor(buf, { patch = 12 } = {}) {
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width, h = meta.height;
    if (!w || !h) return null;
    const p = Math.max(1, Math.min(patch, Math.floor(Math.min(w, h) / 4)));
    const corners = [
      { left: 0, top: 0 },
      { left: w - p, top: 0 },
      { left: 0, top: h - p },
      { left: w - p, top: h - p },
    ];
    const rgbs = [];
    for (const c of corners) {
      // Fresh sharp() per extract (pipelines are single-use). Patch → 1×1 = mean.
      const { data } = await sharp(buf)
        .extract({ left: c.left, top: c.top, width: p, height: p })
        .resize(1, 1, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      rgbs.push([data[0], data[1], data[2]]);
    }
    // Per-channel median of the 4 corners (mean of the two middle values).
    const med = (i) => {
      const v = rgbs.map((r) => r[i]).sort((a, b) => a - b);
      return Math.round((v[1] + v[2]) / 2);
    };
    const hex = [med(0), med(1), med(2)].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  } catch {
    return null;
  }
}
