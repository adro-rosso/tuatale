// src/auto-fit.js
// Find the largest font size at which a given text fits within a target
// region. Uses measureText() iteratively, decrementing font size until
// the text either fits or hits the minimum-size floor.
//
// Foundation for image-aware text placement: pair detectCleanRegion()
// (find available cream area in a Gemini-generated image) with
// fitTextToRegion() (size text to fit that area). See SESSION_NOTES for
// Stage-2 architecture context.

import { measureText } from "./text-measurement.js";

/**
 * Find the largest font size at which `text` fits within `region`.
 *
 * @param {object} opts
 * @param {string}      opts.text                narrative content
 * @param {object}      opts.region              { width, height } in PDF points
 * @param {string}      opts.fontFamily
 * @param {number}      opts.lineHeight          multiplier, e.g. 1.6
 * @param {number}      [opts.maxFontSize=16]    starting size in pt
 * @param {number}      [opts.minFontSize=10]    floor; below this we fail
 * @param {number}      [opts.fontSizeStep=1]    decrement step
 * @param {string|null} [opts.letterSpacing=null]
 * @param {string|null} [opts.fontVariantNumeric=null]
 * @returns {Promise<{
 *   fits: boolean,
 *   fontSize: number | null,
 *   measurement: object | null,
 *   iterations: number,
 *   rejectedSizes: number[],
 * }>}
 */
export async function fitTextToRegion({
  text,
  region,
  fontFamily,
  lineHeight,
  maxFontSize = 16,
  minFontSize = 10,
  fontSizeStep = 1,
  letterSpacing = null,
  fontVariantNumeric = null,
}) {
  if (!text || !region || !fontFamily || !lineHeight) {
    throw new Error("fitTextToRegion: text, region, fontFamily, lineHeight required");
  }
  if (!region.width || !region.height) {
    throw new Error("fitTextToRegion: region must have width and height in pt");
  }

  const rejectedSizes = [];
  let iterations = 0;

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= fontSizeStep) {
    iterations++;
    // CRITICAL: maxWidth passed in points so measureText wraps text to the
    // region's actual width (not a percentage of some page context).
    const measurement = await measureText({
      text,
      fontFamily,
      fontSize,
      lineHeight,
      maxWidth: `${region.width}pt`,
      letterSpacing,
      fontVariantNumeric,
    });
    const heightFits = measurement.heightPt <= region.height;
    const widthFits = measurement.actualMaxWidthPt <= region.width;
    if (heightFits && widthFits) {
      return { fits: true, fontSize, measurement, iterations, rejectedSizes };
    }
    rejectedSizes.push(fontSize);
  }

  return { fits: false, fontSize: null, measurement: null, iterations, rejectedSizes };
}
