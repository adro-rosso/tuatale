// src/region-detection.js
// Single primitive: detectCleanRegion(). Analyzes an image and finds the
// largest rectangular zone of cream pixels within a declared region-of-
// interest. Foundation for image-aware text placement — instead of asking
// Gemini to produce predictable clean regions, we accept Gemini's organic
// output and detect where the actual clean cream area is, then position
// text there. See SESSION_NOTES for the Stage-2 architecture context.

import sharp from "sharp";
import fs from "node:fs";

// ---- Color helpers --------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace(/^#/, "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// Euclidean RGB distance. Empirically reliable for "near cream" detection
// at high lightness. HSL saturation has numerical instability in this
// regime (S = (max-min)/(2-max-min) blows up as max+min approaches 2) —
// see Stage-2 region-detection diagnostic. RGB distance is the simple
// and correct fix for near-white target colors.
function rgbDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ---- Padding walk ---------------------------------------------------------
// Walk outward from each edge of the region until hitting a non-cream pixel
// anywhere in the perpendicular row/column extent. STRICT: a single
// non-cream pixel stops the walk (brittle for noisy edges — known v1 limit).
function computePadding(data, channels, imgW, imgH, region, target, distance) {
  function isCreamAt(x, y) {
    if (x < 0 || x >= imgW || y < 0 || y >= imgH) return false;
    const idx = (y * imgW + x) * channels;
    return rgbDistance(data[idx], data[idx + 1], data[idx + 2], target.r, target.g, target.b) < distance;
  }

  let top = 0, bottom = 0, left = 0, right = 0;

  for (let dy = 1; dy < imgH; dy++) {
    const y = region.y - dy;
    if (y < 0) { top = dy - 1; break; }
    let allCream = true;
    for (let x = region.x; x < region.x + region.width; x++) {
      if (!isCreamAt(x, y)) { allCream = false; break; }
    }
    if (!allCream) { top = dy - 1; break; }
    top = dy;
  }
  for (let dy = 1; dy < imgH; dy++) {
    const y = region.y + region.height - 1 + dy;
    if (y >= imgH) { bottom = dy - 1; break; }
    let allCream = true;
    for (let x = region.x; x < region.x + region.width; x++) {
      if (!isCreamAt(x, y)) { allCream = false; break; }
    }
    if (!allCream) { bottom = dy - 1; break; }
    bottom = dy;
  }
  for (let dx = 1; dx < imgW; dx++) {
    const x = region.x - dx;
    if (x < 0) { left = dx - 1; break; }
    let allCream = true;
    for (let y = region.y; y < region.y + region.height; y++) {
      if (!isCreamAt(x, y)) { allCream = false; break; }
    }
    if (!allCream) { left = dx - 1; break; }
    left = dx;
  }
  for (let dx = 1; dx < imgW; dx++) {
    const x = region.x + region.width - 1 + dx;
    if (x >= imgW) { right = dx - 1; break; }
    let allCream = true;
    for (let y = region.y; y < region.y + region.height; y++) {
      if (!isCreamAt(x, y)) { allCream = false; break; }
    }
    if (!allCream) { right = dx - 1; break; }
    right = dx;
  }

  return { top, right, bottom, left };
}

// ---- Main primitive -------------------------------------------------------

/**
 * Detect the largest clean rectangular cream-colored region inside a
 * declared region-of-interest.
 *
 * @param {object} opts
 * @param {string} opts.imagePath        absolute path to PNG/JPEG to analyze
 * @param {object} opts.roi              fractional bounds {x,y,width,height} in [0..1]
 * @param {string} [opts.creamTarget="#F0E8D8"]
 * @param {number} [opts.creamDistance=30]  RGB Euclidean distance threshold;
 *   pixel is "cream" if rgbDistance(pixel, target) < creamDistance.
 *   Empirically validated at 30 against Gemini-generated images with the
 *   Sophie Blackall painter-vocab style override.
 * @param {number|null} [opts.requiredAspectRatio=null]  optional; warns if mismatch
 * @param {object|null} [opts.minSizePx=null]            optional {width, height} in pixels
 */
export async function detectCleanRegion({
  imagePath,
  roi,
  creamTarget = "#F0E8D8",
  creamDistance = 30,
  requiredAspectRatio = null,
  minSizePx = null,
}) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`detectCleanRegion: image not found at ${imagePath}`);
  }

  // Load image, get raw RGB pixel buffer + dimensions. removeAlpha() strips
  // any alpha channel so we get a clean 3-channel buffer; .raw() emits
  // uncompressed bytes; resolveWithObject returns buffer + dimensions.
  const { data, info } = await sharp(imagePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imgW = info.width;
  const imgH = info.height;
  const channels = info.channels;

  // Resolve ROI fractional coords → pixel coords (clamped).
  const roiX = Math.max(0, Math.floor(roi.x * imgW));
  const roiY = Math.max(0, Math.floor(roi.y * imgH));
  const roiW = Math.min(imgW - roiX, Math.floor(roi.width * imgW));
  const roiH = Math.min(imgH - roiY, Math.floor(roi.height * imgH));
  const roiPx = { x: roiX, y: roiY, width: roiW, height: roiH };

  // Cream target in RGB.
  const target = hexToRgb(creamTarget);

  // Build cream-mask binary matrix over ROI using RGB Euclidean distance.
  const mask = new Uint8Array(roiW * roiH);
  let creamPixelsFound = 0;
  for (let dy = 0; dy < roiH; dy++) {
    for (let dx = 0; dx < roiW; dx++) {
      const x = roiX + dx;
      const y = roiY + dy;
      const idx = (y * imgW + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (rgbDistance(r, g, b, target.r, target.g, target.b) < creamDistance) {
        mask[dy * roiW + dx] = 1;
        creamPixelsFound++;
      }
    }
  }

  // Largest rectangle of all-cream pixels via histogram + monotonic stack.
  const heights = new Int32Array(roiW);
  let bestArea = 0;
  let bestRect = { x: 0, y: 0, width: 0, height: 0 };
  for (let row = 0; row < roiH; row++) {
    for (let col = 0; col < roiW; col++) {
      heights[col] = mask[row * roiW + col] === 1 ? heights[col] + 1 : 0;
    }
    const stack = [];
    for (let col = 0; col <= roiW; col++) {
      const h = col === roiW ? 0 : heights[col];
      while (stack.length > 0 && heights[stack[stack.length - 1]] > h) {
        const topIdx = stack.pop();
        const heightH = heights[topIdx];
        const widthW = stack.length === 0 ? col : col - stack[stack.length - 1] - 1;
        const area = heightH * widthW;
        if (area > bestArea) {
          const leftL = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
          bestRect = { x: leftL, y: row - heightH + 1, width: widthW, height: heightH };
          bestArea = area;
        }
      }
      stack.push(col);
    }
  }

  // Detected rect → image-global coords.
  const region = {
    x: roiX + bestRect.x,
    y: roiY + bestRect.y,
    width: bestRect.width,
    height: bestRect.height,
    xPct: ((roiX + bestRect.x) / imgW) * 100,
    yPct: ((roiY + bestRect.y) / imgH) * 100,
    widthPct: (bestRect.width / imgW) * 100,
    heightPct: (bestRect.height / imgH) * 100,
  };

  // creamDensity over the detected region (will be 100% for hard-rect search;
  // exposed for future soft-tolerance enhancement and for the warning logic).
  let creamInRegion = 0;
  const pixelsInRegion = bestRect.width * bestRect.height;
  if (pixelsInRegion > 0) {
    for (let dy = bestRect.y; dy < bestRect.y + bestRect.height; dy++) {
      for (let dx = bestRect.x; dx < bestRect.x + bestRect.width; dx++) {
        if (mask[dy * roiW + dx] === 1) creamInRegion++;
      }
    }
  }
  const creamDensity = pixelsInRegion > 0 ? creamInRegion / pixelsInRegion : 0;

  // Padding from each edge.
  const paddingPx = computePadding(data, channels, imgW, imgH, region, target, creamDistance);

  // Score.
  const minPad = Math.min(paddingPx.top, paddingPx.right, paddingPx.bottom, paddingPx.left);
  const maxPad = Math.max(paddingPx.top, paddingPx.right, paddingPx.bottom, paddingPx.left);
  const normalizedPadding = Math.min(minPad / 100, 1.0);
  const score = 0.6 * creamDensity + 0.4 * normalizedPadding;

  // Warnings.
  const warnings = [];
  if (creamDensity < 0.90) {
    warnings.push(`Detected region creamDensity below 90% (got ${(creamDensity * 100).toFixed(1)}%)`);
  }
  if (bestRect.width < 400 || bestRect.height < 100) {
    warnings.push(`Detected region smaller than typical text area (${bestRect.width}×${bestRect.height} px)`);
  }
  if (maxPad > 0 && minPad < maxPad / 3) {
    warnings.push(`Detected region has asymmetric padding (min=${minPad}, max=${maxPad})`);
  }
  if (minSizePx && (bestRect.width < minSizePx.width || bestRect.height < minSizePx.height)) {
    warnings.push(`Detected region failed minSizePx (${bestRect.width}×${bestRect.height} < ${minSizePx.width}×${minSizePx.height})`);
  }
  if (requiredAspectRatio !== null && bestRect.width > 0 && bestRect.height > 0) {
    const actualRatio = bestRect.width / bestRect.height;
    const ratioDiff = Math.abs(actualRatio - requiredAspectRatio) / requiredAspectRatio;
    if (ratioDiff > 0.2) {
      warnings.push(
        `Detected region aspect ratio ${actualRatio.toFixed(2)} differs from required ${requiredAspectRatio.toFixed(2)} by >20%`
      );
    }
  }

  return {
    region,
    quality: { creamDensity, paddingPx, score },
    diagnostics: {
      roiPixelBounds: roiPx,
      pixelsAnalyzed: roiW * roiH,
      creamPixelsFound,
      candidateRegions: 1,
    },
    warnings,
  };
}
