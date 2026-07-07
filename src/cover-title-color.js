// src/cover-title-color.js — adaptive cover title colour (2026-07-07).
//
// The integrated cover title reads best DARK (espresso) on a light title-zone and
// LIGHT (cream) on a dark one. This samples the hero's TITLE ZONE brightness (the
// same sharp corner-patch → 1×1-mean trick as image-bg.sampleBackgroundColor) and
// picks accordingly. Cream is the SAFE FALLBACK: it holds on any hero via the
// integrated treatment's soft dark scrim, so anything not clearly light → cream.

import sharp from "sharp";

// Lower-centre band where the integrated title sits (fractions of the hero).
// Matches the .lower placement in front-matter's integrated cover: the title
// occupies roughly the bottom quarter, centred, ~7% side insets.
export const TITLE_ZONE = { leftFrac: 0.12, topFrac: 0.64, widthFrac: 0.76, heightFrac: 0.28 };

// Rec.709 relative luminance (0-255) from mean RGB.
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A title-zone at/above this luminance is "clearly light" → espresso. Below →
// cream (covers dark zones AND ambiguous mid-tones; cream is the default/fallback).
export const LIGHT_LUMA_THRESHOLD = 140;

// Pure pick (zone luminance → colour). Testable without image I/O.
export function pickTitleColorFromLuma(zoneLuma) {
  if (typeof zoneLuma !== "number" || Number.isNaN(zoneLuma)) return "cream";
  return zoneLuma >= LIGHT_LUMA_THRESHOLD ? "espresso" : "cream";
}

// Mean luminance of the title zone. Accepts a path or a Buffer. Returns a 0-255
// number, or null on any failure (caller falls back to cream).
export async function sampleTitleZoneLuma(image, zone = TITLE_ZONE) {
  try {
    const meta = await sharp(image).metadata();
    const w = meta.width, h = meta.height;
    if (!w || !h) return null;
    const left = Math.max(0, Math.min(w - 1, Math.round(zone.leftFrac * w)));
    const top = Math.max(0, Math.min(h - 1, Math.round(zone.topFrac * h)));
    const width = Math.max(1, Math.min(w - left, Math.round(zone.widthFrac * w)));
    const height = Math.max(1, Math.min(h - top, Math.round(zone.heightFrac * h)));
    const { data } = await sharp(image)
      .extract({ left, top, width, height })
      .resize(1, 1, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return luma(data[0], data[1], data[2]);
  } catch {
    return null;
  }
}

// Adaptive pick for a hero (path or Buffer). Cream on any failure/ambiguity.
export async function pickTitleColor(image, zone = TITLE_ZONE) {
  const zl = await sampleTitleZoneLuma(image, zone);
  return zl == null ? "cream" : pickTitleColorFromLuma(zl);
}
