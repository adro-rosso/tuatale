// scripts/generate-pdf.js — Layout v3 (Path C variance: Classic + Cinematic +
// Asymmetric, system-picked per page), locked 2026-05-17.
//
// Takes an existing book directory (story.json + meta.json + character-
// sheets/sheet-01.png + pages/page-NN.{png,txt}) and produces book.pdf in
// that same directory. Pages render under one of three layouts based on
// PAGE_LAYOUT_BY_POSITION (position-based dispatch; schema-tagged dispatch
// is a later step in the locked implementation sequence).
//
// Layout-v3 changes from v2:
//   - PAGE_LAYOUT_BY_POSITION array drives per-page renderer selection.
//   - Three renderer functions: renderClassicPage (v2's logic, extracted),
//     renderCinematicPage (full-bleed image + adaptive translucent panel),
//     renderAsymmetricPage (upper-right image + lower-left text band).
//   - Cinematic → Classic fallback when image is portrait-orientation.
//   - Per-page console log shows layout used + text utilization (or
//     fallback reason) for visual audit against the rendered PDF.
//   - Layout distribution + fallbacks reported in the summary block.
//
// All v2 invariants preserved: cream background, image border on Classic +
// Asymmetric (Cinematic is full-bleed, no border), Times typography, exit
// codes, skip-on-missing pages, overflow warning, no CONFIRM gate.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

// ---- Paths -----------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// ---- Layout constants — shared across renderers ----------------------------
// All dimensions in PDF points. 1 point = 1/72 inch.

const PAGE_WIDTH = 11 * 72;     // 792 pt — landscape letter
const PAGE_HEIGHT = 8.5 * 72;   // 612 pt
const MARGIN = 0.5 * 72;        // 36 pt — 0.5" on all four sides

// ---- Layout constants — Classic (v2 geometry, unchanged) -------------------
//
// Derivation (locked 2026-05-17 at v2's 18pt body, re-confirmed for v3):
//   Worst-case observed narrative: Sage page-10, 491 chars / 88 words.
//   At 18pt Times-Roman, 720pt line width, ~8.5pt avg char width:
//     6 lines × (18 × 1.15 natural + 6 lineGap) ≈ 6 × 26.7pt ≈ 160pt.
//   Target utilization: ~70%. Required text budget: ~229pt → rounded to 240.
//   Image height = 612 - 72 - 240 - 12 = 288.
//   Worst-case fill at 240pt: ~67%.
//
const IMAGE_REGION_X = MARGIN;
const IMAGE_REGION_Y = MARGIN;
const IMAGE_REGION_WIDTH = PAGE_WIDTH - 2 * MARGIN;  // 720 pt
const IMAGE_REGION_HEIGHT = 288;                      // 4.00"

const IMAGE_TEXT_GAP = 12;      // pt — gap between image and text below

const TEXT_REGION_X = MARGIN;
const TEXT_REGION_Y = MARGIN + IMAGE_REGION_HEIGHT + IMAGE_TEXT_GAP;       // 336 pt
const TEXT_REGION_WIDTH = PAGE_WIDTH - 2 * MARGIN;                         // 720 pt
const TEXT_REGION_HEIGHT = PAGE_HEIGHT - TEXT_REGION_Y - MARGIN;           // 240 pt

// ---- Layout constants — Cinematic full-bleed -------------------------------
//
// Image fills entire page (no margin, no border). Body text sits in a
// semi-transparent cream panel anchored bottom-left, height adapts to text.
//
// Derivation (locked 2026-05-17):
//   Panel width: 70% page width = 554pt. Inner text width: 554 - 32 padding
//     = 522pt. (Research doc said 60%, which produces nearly 50%-page-height
//     panel for worst case — chunky. 70% is wider+shorter, more film-subtitle.)
//   Sage page-10 worst case: 491 chars at 522pt width → 8 lines × 26.7pt
//     = 214pt rendered text.
//   Adaptive panel height = textHeight + 2*padding, capped at MAX_HEIGHT.
//   MAX_HEIGHT = 50% page height = 306pt → inner height cap = 274pt.
//   Worst-case panel height: 214 + 32 = 246pt (80% of MAX cap).
//
// Portrait image outliers fall back to Classic — see renderCinematicPage().
const CINEMATIC_PANEL_WIDTH = Math.round(PAGE_WIDTH * 0.70);       // 554 pt
const CINEMATIC_PANEL_PADDING = 16;                                  // pt — text inset
const CINEMATIC_PANEL_RADIUS = 8;                                    // pt — rounded corners
const CINEMATIC_PANEL_OPACITY = 0.85;                                // 85% — image shows faintly through
const CINEMATIC_PANEL_COLOR = "#F8F4ED";                             // same cream as page background
const CINEMATIC_PANEL_MAX_HEIGHT = Math.round(PAGE_HEIGHT * 0.50);   // 306 pt — adaptive cap
// Panel position cycles across cinematic occurrences in PAGE_LAYOUT_BY_POSITION.
// Each scene-role gets a position chosen for what the role demands — not
// arbitrary rotation:
//   [0] bottom-left  → page 1 (establishing) — Western reading-start corner;
//                       eye flows image→text after absorbing the world-shot.
//   [1] top-left     → page 9 (climactic)    — disrupts the bottom-anchor
//                       pattern reader has established by page 8; forces
//                       text-before-image, arrests the eye on the climax.
//   [2] bottom-right → page 12 (closing)     — mirror of page 1's BL anchor
//                       (same vertical, opposite horizontal); bookend rhyme
//                       signals structural closure.
const CINEMATIC_PANEL_POSITIONS = ["bottom-left", "top-left", "bottom-right"];

// ---- Layout constants — Asymmetric breathing -------------------------------
//
// Image upper-right, text lower-left with generous whitespace.
//
// Derivation (locked 2026-05-17):
//   Image region: 60% × 40% (NOT 60% × 60% from the original sketch — the
//   taller image leaves <143pt for text below, which doesn't fit even our
//   typical narrative. 60% × 40% gives 265pt budget; worst case 81%.)
//   Image is right-anchored at the top; text is left-anchored at the bottom.
//   30pt breathing gap between image bottom and text top.
//
//   Sage page-10 worst case: 491 chars at 720pt width → 6 lines × 26.7pt
//     = 160pt rendered text. 160/265 = 60% of budget.
//
//   Text width expanded 540 → 720 on 2026-05-17 per layout-diagnostic.md
//   fix A: the original 540pt text width left a 180pt empty strip on the
//   right of text, which combined with the upper-left empty quadrant to
//   form a visually-broken L-shape (two disconnected empty zones). Full
//   content width consolidates negative space into one upper-left zone.
//   Trade-off accepted: asymmetric character is weakened — the diagonal
//   eye-flow (UR image → LL text) becomes vertical (UR image → full-width
//   band below). Image-right-anchored + upper-left empty quadrant still
//   distinguish this layout from Classic, but less dramatically than the
//   original 540pt-width spec did.
//
const ASYMMETRIC_IMAGE_REGION_WIDTH = Math.round(PAGE_WIDTH * 0.60);    // 475 pt
const ASYMMETRIC_IMAGE_REGION_HEIGHT = Math.round(PAGE_HEIGHT * 0.40);  // 245 pt
const ASYMMETRIC_IMAGE_REGION_X = PAGE_WIDTH - MARGIN - ASYMMETRIC_IMAGE_REGION_WIDTH;  // 281 pt (right-anchored)
const ASYMMETRIC_IMAGE_REGION_Y = MARGIN;                                                // 36 pt (top-anchored)

const ASYMMETRIC_IMAGE_TEXT_GAP = 30;  // pt — generous (vs Classic's 12)

const ASYMMETRIC_TEXT_X = MARGIN;       // left-anchored
const ASYMMETRIC_TEXT_Y = ASYMMETRIC_IMAGE_REGION_Y + ASYMMETRIC_IMAGE_REGION_HEIGHT + ASYMMETRIC_IMAGE_TEXT_GAP;  // 311 pt
const ASYMMETRIC_TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;  // 720 pt — full content width (see derivation above for why)
const ASYMMETRIC_TEXT_HEIGHT = PAGE_HEIGHT - MARGIN - ASYMMETRIC_TEXT_Y;  // 265 pt

// ---- Page-layout dispatch (Path C: position-based) -------------------------
//
// Index 0 = cover page; indices 1..12 = scene pages 1..12.
// Distribution across the 12 scene pages: 7 classic / 3 cinematic / 2 asymmetric.
// Position rules can't catch every story shape — variance comes from the MIX
// feeling book-shaped, not from every page matching its scene perfectly.
//
// Schema-tagged dispatch (Sonnet picks intent per scene) is Step 2 in the
// locked implementation sequence — comes after this position-based variant
// has had its gut-test.
const PAGE_LAYOUT_BY_POSITION = [
  "cover",       // index 0 — cover (cover page renders before the scene loop; this entry is documentation)
  "cinematic",   // page 1  — establishing shot
  "classic",     // page 2
  "classic",     // page 3
  "classic",     // page 4
  "asymmetric",  // page 5  — early turning point / reflective moment
  "classic",     // page 6
  "classic",     // page 7
  "classic",     // page 8
  "cinematic",   // page 9  — climactic beat
  "classic",     // page 10
  "asymmetric",  // page 11 — late emotional moment
  "cinematic",   // page 12 — closing
];

// ---- Typography constants --------------------------------------------------
const FONT_BODY = "Times-Roman";
const FONT_TITLE = "Times-Bold";
const FONT_SUBTITLE = "Times-Italic";

const TITLE_FONT_SIZE = 32;
const SUBTITLE_FONT_SIZE = 18;
const BODY_FONT_SIZE = 18;
const LINE_HEIGHT_MULTIPLIER = 1.4;  // used only for title-subtitle vertical positioning
const BODY_LINE_GAP = 6;             // pt — locked explicit (NOT derived from multiplier)
const TITLE_SUBTITLE_GAP = 12;

// ---- Visual-treatment constants --------------------------------------------
const PAGE_BACKGROUND_COLOR = "#F8F4ED";   // warm cream — paper texture
const IMAGE_BORDER_COLOR = "#B8A99A";       // warm gray-brown — printed-illustration frame
const IMAGE_BORDER_WIDTH = 1.5;             // pt — visible on dense phone screens
const SUBTITLE_COLOR = "#5C5044";           // muted warm brown — cover subtitle hierarchy

// ---- Overflow warning threshold --------------------------------------------
const OVERFLOW_WARN_THRESHOLD = 0.90;

// ---- Usage hint ------------------------------------------------------------
const USAGE = `
Usage: node scripts/generate-pdf.js [flags]

Required:
  --book-dir <path>    Path to an existing book directory.
                       Must contain:
                         story.json
                         meta.json
                         character-sheets/sheet-01.png  (cover art)
                         pages/page-NN.png              (NN = 01..12)
                         pages/page-NN.txt              (NN = 01..12)

Output:
  Writes book.pdf into the given book directory.

Both --flag value and --flag=value forms are accepted.
`.trim();

// ---- Helpers (copied verbatim from scripts/generate-story.js) --------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(
        `Unexpected positional argument: ${a}. All inputs must be passed as --flag.`
      );
    }
    const eqIndex = a.indexOf("=");
    if (eqIndex >= 0) {
      const key = a.slice(2, eqIndex);
      args[key] = a.slice(eqIndex + 1);
    } else {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }
  return args;
}

function displayPath(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, "/");
}

// ---- Layout helpers --------------------------------------------------------

// Compute the actual rendered bounding box for an image being fit-to-box'd
// into a region. pdfkit's doc.image() doesn't return the rendered bounds, so
// we compute manually using the same fit-to-box math: scale by min ratio,
// centre within the region.
function computeFitToBoxBounds(nativeW, nativeH, regionX, regionY, regionW, regionH) {
  const scale = Math.min(regionW / nativeW, regionH / nativeH);
  const renderedW = nativeW * scale;
  const renderedH = nativeH * scale;
  return {
    x: regionX + (regionW - renderedW) / 2,
    y: regionY + (regionH - renderedH) / 2,
    width: renderedW,
    height: renderedH,
  };
}

// Fill the entire page with the warm-cream background. Call at the start of
// every page that needs the cream paper texture (Classic + Asymmetric, and
// the cover). NOT called for Cinematic — the image fills the page itself.
function fillPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(PAGE_BACKGROUND_COLOR);
  doc.restore();
}

// Embed an image with fit-to-box scaling and draw a warm-gray border around
// the actual rendered bounds. Region is passed as args so this helper serves
// both Classic (TEXT_REGION-sized) and Asymmetric (smaller region, upper-right).
// Returns bounds on success, throws on failure (caller handles).
function embedImageWithBorder(doc, imagePath, regionX, regionY, regionW, regionH) {
  const img = doc.openImage(imagePath);
  const bounds = computeFitToBoxBounds(
    img.width, img.height,
    regionX, regionY, regionW, regionH
  );
  doc.image(img, regionX, regionY, {
    fit: [regionW, regionH],
    align: "center",
    valign: "center",
  });
  doc.save();
  doc.lineWidth(IMAGE_BORDER_WIDTH).strokeColor(IMAGE_BORDER_COLOR);
  doc.rect(bounds.x, bounds.y, bounds.width, bounds.height).stroke();
  doc.restore();
  return bounds;
}

// Draw the semi-transparent cream panel used by Cinematic layout. The panel
// goes on top of the full-bleed image; text is then drawn on top of the
// panel by the caller (so the caller can use the same coordinates that this
// helper used to size the panel).
function drawCinematicPanel(doc, panelX, panelY, panelW, panelH) {
  doc.save();
  doc.fillOpacity(CINEMATIC_PANEL_OPACITY);
  doc.roundedRect(panelX, panelY, panelW, panelH, CINEMATIC_PANEL_RADIUS)
     .fill(CINEMATIC_PANEL_COLOR);
  doc.restore();
}

// Compute panel (x, y) for a given position name and the adaptive panel
// height. Supports all four corners; we currently use three of them via
// CINEMATIC_PANEL_POSITIONS. Throws on unknown name so typos surface loudly
// rather than silently rendering at (NaN, NaN).
function computeCinematicPanelPosition(positionName, panelHeight) {
  switch (positionName) {
    case "bottom-left":
      return { x: MARGIN, y: PAGE_HEIGHT - panelHeight - MARGIN };
    case "bottom-right":
      return { x: PAGE_WIDTH - CINEMATIC_PANEL_WIDTH - MARGIN, y: PAGE_HEIGHT - panelHeight - MARGIN };
    case "top-left":
      return { x: MARGIN, y: MARGIN };
    case "top-right":
      return { x: PAGE_WIDTH - CINEMATIC_PANEL_WIDTH - MARGIN, y: MARGIN };
    default:
      throw new Error(`Unknown cinematic panel position: "${positionName}"`);
  }
}

// ---- Renderers -------------------------------------------------------------
// Each renderer adds one page to the doc and returns a result struct that
// the caller uses for logging + summary. Renderers do NOT log their own
// per-page line — the caller does, so the log format stays consistent.
// Renderers DO log warnings (e.g. image decode failed) inline when surfaced.

// Cover page — image + title + theme subtitle. Same layout as Classic but
// with Title typography instead of body text.
function renderCoverPage(doc, childName, theme, coverImagePath) {
  doc.addPage();
  fillPageBackground(doc);

  let coverImageEmbedded = false;
  if (fs.existsSync(coverImagePath)) {
    try {
      embedImageWithBorder(
        doc, coverImagePath,
        IMAGE_REGION_X, IMAGE_REGION_Y, IMAGE_REGION_WIDTH, IMAGE_REGION_HEIGHT
      );
      coverImageEmbedded = true;
    } catch (err) {
      console.log(`  ⚠ cover image embed failed: ${err?.message ?? err}. Cover will render text-only.`);
    }
  } else {
    console.log(`  ⚠ cover image not found at ${displayPath(coverImagePath)}. Cover will render text-only.`);
  }

  doc.font(FONT_TITLE).fontSize(TITLE_FONT_SIZE).fillColor("black");
  doc.text(`${childName}'s Story`, TEXT_REGION_X, TEXT_REGION_Y, {
    width: TEXT_REGION_WIDTH,
    align: "center",
  });

  const subtitleY = TEXT_REGION_Y + TITLE_FONT_SIZE * LINE_HEIGHT_MULTIPLIER + TITLE_SUBTITLE_GAP;
  doc.font(FONT_SUBTITLE).fontSize(SUBTITLE_FONT_SIZE).fillColor(SUBTITLE_COLOR);
  doc.text(theme, TEXT_REGION_X, subtitleY, {
    width: TEXT_REGION_WIDTH,
    align: "center",
  });

  // Reset state for subsequent pages.
  doc.fillColor("black");

  return { coverImageEmbedded };
}

// Classic — v2's layout, image-top / text-below with cream background +
// image border. Also serves as the Cinematic fallback path for portrait
// images. options.fallbackReason is propagated to the result for logging.
function renderClassicPage(doc, scene, imagePath, narrativeText, options = {}) {
  doc.addPage();
  fillPageBackground(doc);

  let imageEmbedded = true;
  try {
    embedImageWithBorder(
      doc, imagePath,
      IMAGE_REGION_X, IMAGE_REGION_Y, IMAGE_REGION_WIDTH, IMAGE_REGION_HEIGHT
    );
  } catch (err) {
    imageEmbedded = false;
    const pageNum = String(scene.page).padStart(2, "0");
    console.log(`  ⚠ page ${pageNum}: image decode failed (${err?.message ?? err}). Page rendered text-only.`);
  }

  doc.font(FONT_BODY).fontSize(BODY_FONT_SIZE).fillColor("black");

  const renderedHeight = doc.heightOfString(narrativeText, {
    width: TEXT_REGION_WIDTH,
    lineGap: BODY_LINE_GAP,
  });

  doc.text(narrativeText, TEXT_REGION_X, TEXT_REGION_Y, {
    width: TEXT_REGION_WIDTH,
    height: TEXT_REGION_HEIGHT,
    align: "left",
    lineGap: BODY_LINE_GAP,
    ellipsis: true,
  });

  return {
    layoutUsed: "classic",
    fallbackReason: options.fallbackReason || null,
    imageEmbedded,
    textRenderedHeight: renderedHeight,
    textRegionHeight: TEXT_REGION_HEIGHT,
    textUtilizationPct: (renderedHeight / TEXT_REGION_HEIGHT) * 100,
    textRegionLabel: "classic text region",
  };
}

// Cinematic full-bleed — image fills the entire page, body text in a
// semi-transparent cream panel anchored bottom-left, height adapts to text.
// Falls back to Classic if image is portrait-orientation (would pillarbox
// on a landscape page and defeat the cinematic intent).
function renderCinematicPage(doc, scene, imagePath, narrativeText, cinematicIndex) {
  // Check image orientation first — fall back to Classic before adding the
  // page if the image is portrait. This way the page count stays correct.
  let img;
  try {
    img = doc.openImage(imagePath);
  } catch (err) {
    // openImage failed — defer to Classic, which will catch the same error
    // and render text-only with a clean fallback path.
    return renderClassicPage(doc, scene, imagePath, narrativeText, {
      fallbackReason: "cinematic→classic: image open failed",
    });
  }

  if (img.height > img.width) {
    return renderClassicPage(doc, scene, imagePath, narrativeText, {
      fallbackReason: "cinematic→classic: image is portrait",
    });
  }

  doc.addPage();
  // No fillPageBackground — image fills the page edge-to-edge.

  let imageEmbedded = true;
  try {
    doc.image(img, 0, 0, {
      fit: [PAGE_WIDTH, PAGE_HEIGHT],
      align: "center",
      valign: "center",
    });
  } catch (err) {
    imageEmbedded = false;
    // No image — fill cream background so the page isn't blank.
    fillPageBackground(doc);
    const pageNum = String(scene.page).padStart(2, "0");
    console.log(`  ⚠ page ${pageNum}: cinematic image embed failed (${err?.message ?? err}). Page rendered with cream background + panel only.`);
  }

  // Compute adaptive panel height based on actual text height.
  doc.font(FONT_BODY).fontSize(BODY_FONT_SIZE);
  const innerWidth = CINEMATIC_PANEL_WIDTH - 2 * CINEMATIC_PANEL_PADDING;
  const textHeight = doc.heightOfString(narrativeText, {
    width: innerWidth,
    lineGap: BODY_LINE_GAP,
  });
  const panelHeight = Math.min(
    textHeight + 2 * CINEMATIC_PANEL_PADDING,
    CINEMATIC_PANEL_MAX_HEIGHT
  );
  // Pick this cinematic page's panel position from the scene-role cycle.
  // Modulo guards against cinematicIndex exceeding the array length (e.g. if
  // PAGE_LAYOUT_BY_POSITION is later edited to include a 4th cinematic page
  // without extending CINEMATIC_PANEL_POSITIONS).
  const positionName = CINEMATIC_PANEL_POSITIONS[
    cinematicIndex % CINEMATIC_PANEL_POSITIONS.length
  ];
  const { x: panelX, y: panelY } = computeCinematicPanelPosition(positionName, panelHeight);

  // Draw the panel (semi-transparent), then the text on top (fully opaque).
  drawCinematicPanel(doc, panelX, panelY, CINEMATIC_PANEL_WIDTH, panelHeight);

  doc.save();
  doc.fillOpacity(1).fillColor("black");
  doc.font(FONT_BODY).fontSize(BODY_FONT_SIZE);
  doc.text(
    narrativeText,
    panelX + CINEMATIC_PANEL_PADDING,
    panelY + CINEMATIC_PANEL_PADDING,
    {
      width: innerWidth,
      height: panelHeight - 2 * CINEMATIC_PANEL_PADDING,
      align: "left",
      lineGap: BODY_LINE_GAP,
      ellipsis: true,
    }
  );
  doc.restore();

  // Utilization = textHeight vs the maximum inner panel height it COULD have
  // grown to. This is the meaningful overflow metric — if we approach 100%
  // the panel is approaching the MAX_HEIGHT cap and text will start clipping.
  const maxInnerHeight = CINEMATIC_PANEL_MAX_HEIGHT - 2 * CINEMATIC_PANEL_PADDING;

  return {
    layoutUsed: "cinematic",
    fallbackReason: null,
    imageEmbedded,
    textRenderedHeight: textHeight,
    textRegionHeight: maxInnerHeight,
    textUtilizationPct: (textHeight / maxInnerHeight) * 100,
    textRegionLabel: "cinematic panel",
  };
}

// Asymmetric breathing — image upper-right (~60% × 40%), text lower-left
// (~68% × ~44%), with generous whitespace under the image and on the right
// side of the text. Same image border + cream background as Classic.
function renderAsymmetricPage(doc, scene, imagePath, narrativeText) {
  doc.addPage();
  fillPageBackground(doc);

  let imageEmbedded = true;
  try {
    embedImageWithBorder(
      doc, imagePath,
      ASYMMETRIC_IMAGE_REGION_X, ASYMMETRIC_IMAGE_REGION_Y,
      ASYMMETRIC_IMAGE_REGION_WIDTH, ASYMMETRIC_IMAGE_REGION_HEIGHT
    );
  } catch (err) {
    imageEmbedded = false;
    const pageNum = String(scene.page).padStart(2, "0");
    console.log(`  ⚠ page ${pageNum}: image decode failed (${err?.message ?? err}). Page rendered text-only.`);
  }

  doc.font(FONT_BODY).fontSize(BODY_FONT_SIZE).fillColor("black");

  const renderedHeight = doc.heightOfString(narrativeText, {
    width: ASYMMETRIC_TEXT_WIDTH,
    lineGap: BODY_LINE_GAP,
  });

  doc.text(narrativeText, ASYMMETRIC_TEXT_X, ASYMMETRIC_TEXT_Y, {
    width: ASYMMETRIC_TEXT_WIDTH,
    height: ASYMMETRIC_TEXT_HEIGHT,
    align: "left",
    lineGap: BODY_LINE_GAP,
    ellipsis: true,
  });

  return {
    layoutUsed: "asymmetric",
    fallbackReason: null,
    imageEmbedded,
    textRenderedHeight: renderedHeight,
    textRegionHeight: ASYMMETRIC_TEXT_HEIGHT,
    textUtilizationPct: (renderedHeight / ASYMMETRIC_TEXT_HEIGHT) * 100,
    textRegionLabel: "asymmetric text region",
  };
}

// ---- Parse + validate args -------------------------------------------------
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

const bookDirArg = args["book-dir"];
if (!bookDirArg) {
  console.error("FAIL: missing required flag: --book-dir");
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

const bookDir = path.resolve(bookDirArg);
if (!fs.existsSync(bookDir) || !fs.statSync(bookDir).isDirectory()) {
  console.error(`FAIL: --book-dir does not exist or is not a directory: ${displayPath(bookDir)}`);
  process.exit(1);
}

// ---- Required-input validation ---------------------------------------------
const storyPath = path.join(bookDir, "story.json");
const metaPath = path.join(bookDir, "meta.json");
const sheetsDir = path.join(bookDir, "character-sheets");
const pagesDir = path.join(bookDir, "pages");
const coverImagePath = path.join(sheetsDir, "sheet-01.png");
const outputPdfPath = path.join(bookDir, "book.pdf");

if (!fs.existsSync(storyPath)) {
  console.error(`FAIL: required file missing: ${displayPath(storyPath)}`);
  process.exit(1);
}
if (!fs.existsSync(metaPath)) {
  console.error(`FAIL: required file missing: ${displayPath(metaPath)}`);
  process.exit(1);
}
if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) {
  console.error(`FAIL: required dir missing: ${displayPath(pagesDir)}`);
  process.exit(1);
}

let story, meta;
try {
  story = JSON.parse(fs.readFileSync(storyPath, "utf8"));
} catch (err) {
  console.error(`FAIL: could not parse ${displayPath(storyPath)}: ${err?.message ?? err}`);
  process.exit(1);
}
try {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
} catch (err) {
  console.error(`FAIL: could not parse ${displayPath(metaPath)}: ${err?.message ?? err}`);
  process.exit(1);
}

const childName = meta?.inputs?.child?.name;
const theme = meta?.inputs?.theme;
if (typeof childName !== "string" || childName.trim() === "") {
  console.error(`FAIL: meta.json missing inputs.child.name (got: ${JSON.stringify(childName)})`);
  process.exit(1);
}
if (typeof theme !== "string" || theme.trim() === "") {
  console.error(`FAIL: meta.json missing inputs.theme (got: ${JSON.stringify(theme)})`);
  process.exit(1);
}
if (!Array.isArray(story?.scenes) || story.scenes.length !== 12) {
  console.error(
    `FAIL: story.json scenes is not an array of exactly 12 ` +
    `(got: ${Array.isArray(story?.scenes) ? story.scenes.length : "non-array"})`
  );
  process.exit(1);
}

// ---- Build PDF -------------------------------------------------------------
console.log();
console.log(`Building PDF for ${displayPath(bookDir)}...`);
console.log(`Writing book.pdf to ${displayPath(outputPdfPath)} (will overwrite existing if present).`);

const doc = new PDFDocument({
  size: [PAGE_WIDTH, PAGE_HEIGHT],
  margin: 0,
  autoFirstPage: false,
});

const stream = fs.createWriteStream(outputPdfPath);
doc.pipe(stream);

const skipped = {
  coverImage: false,
  pages: [],  // { page, reason }
};

// Track layout distribution + fallbacks for the summary block.
const layoutCounts = { classic: 0, cinematic: 0, asymmetric: 0 };
const fallbacks = [];  // { page, reason }

// ---- Cover page ------------------------------------------------------------
const coverResult = renderCoverPage(doc, childName, theme, coverImagePath);
if (!coverResult.coverImageEmbedded) {
  skipped.coverImage = true;
}
console.log(`  → cover rendered${coverResult.coverImageEmbedded ? "" : " (text-only)"}`);

// ---- Scene pages -----------------------------------------------------------
const pagesRendered = [];

// Cycles CINEMATIC_PANEL_POSITIONS across cinematic pages. Incremented after
// every cinematic dispatch — INCLUDING when renderCinematicPage internally
// falls back to Classic (portrait image or openImage failure). Rationale: the
// position cycle is keyed to scene-role intent (establishing → climactic →
// closing), not to whether the cinematic layout actually rendered. If we only
// incremented on successful cinematic renders, a single fallback on page 1
// would shift page 9 to "bottom-left" and page 12 to "top-left", collapsing
// the bookend-rhyme between pages 1 and 12. Better to advance the cycle
// unconditionally — the index is consumed only when the next cinematic page
// actually renders cinematic.
let cinematicCount = 0;

for (let i = 0; i < story.scenes.length; i++) {
  const scene = story.scenes[i];
  const pageNum = String(scene.page).padStart(2, "0");
  const imagePath = path.join(pagesDir, `page-${pageNum}.png`);
  const textPath = path.join(pagesDir, `page-${pageNum}.txt`);

  const imageExists = fs.existsSync(imagePath);
  const textExists = fs.existsSync(textPath);

  // Skip-on-missing (same as v2)
  if (!imageExists && !textExists) {
    skipped.pages.push({ page: scene.page, reason: "image and text both missing" });
    console.log(`  ✗ page ${pageNum}: skipped (image + text both missing)`);
    continue;
  }
  if (!imageExists) {
    skipped.pages.push({ page: scene.page, reason: "image missing" });
    console.log(`  ✗ page ${pageNum}: skipped (image missing — per skip-page policy)`);
    continue;
  }
  if (!textExists) {
    skipped.pages.push({ page: scene.page, reason: "text missing" });
    console.log(`  ✗ page ${pageNum}: skipped (text missing)`);
    continue;
  }

  // Read narrative text (renderers expect it pre-read so they don't all have
  // to handle read errors).
  let narrativeText;
  try {
    narrativeText = fs.readFileSync(textPath, "utf8");
  } catch (err) {
    skipped.pages.push({ page: scene.page, reason: `text read failed: ${err?.message ?? err}` });
    console.log(`  ✗ page ${pageNum}: text read failed (${err?.message ?? err}). Skipped.`);
    continue;
  }

  // Dispatch to the renderer for this position.
  const layoutTag = PAGE_LAYOUT_BY_POSITION[scene.page];
  let result;
  switch (layoutTag) {
    case "classic":
      result = renderClassicPage(doc, scene, imagePath, narrativeText);
      break;
    case "cinematic":
      result = renderCinematicPage(doc, scene, imagePath, narrativeText, cinematicCount);
      cinematicCount++;
      break;
    case "asymmetric":
      result = renderAsymmetricPage(doc, scene, imagePath, narrativeText);
      break;
    default:
      throw new Error(
        `Unknown layout tag at page ${scene.page}: "${layoutTag}". ` +
        `Check PAGE_LAYOUT_BY_POSITION (expected one of: classic, cinematic, asymmetric).`
      );
  }

  pagesRendered.push(scene.page);
  layoutCounts[result.layoutUsed]++;
  if (result.fallbackReason) {
    fallbacks.push({ page: scene.page, reason: result.fallbackReason });
  }

  // Per-page log line — format matches the proposal so visual audit against
  // the PDF is straightforward.
  const layoutDisplay = result.fallbackReason || result.layoutUsed;
  const regionShortName = result.layoutUsed === "cinematic" ? "panel" : "text region";
  const suffix = result.imageEmbedded
    ? `(${Math.round(result.textUtilizationPct)}% ${regionShortName})`
    : `(text-only — image decode failed)`;
  console.log(`  → page ${pageNum} [${layoutDisplay}] rendered  ${suffix}`);

  // Overflow warning per renderer
  if (result.textUtilizationPct > OVERFLOW_WARN_THRESHOLD * 100) {
    console.log(
      `  ⚠ page ${pageNum}: narrative rendered at ~${Math.round(result.textUtilizationPct)}% ` +
      `of ${result.textRegionLabel} (${Math.round(result.textRenderedHeight)}pt/${Math.round(result.textRegionHeight)}pt). ` +
      `Close to overflow threshold — consider tightening or escalating to a layout fix.`
    );
  }
}

// ---- Finalize stream -------------------------------------------------------
doc.end();
await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

// ---- Summary ---------------------------------------------------------------
const outputSize = fs.statSync(outputPdfPath).size;
const outputSizeKB = (outputSize / 1024).toFixed(1);

const scenesSucceeded = pagesRendered.length;
const scenesFailed = skipped.pages.length;

console.log();
console.log("=".repeat(70));
console.log("PDF generation complete.");
console.log("=".repeat(70));
console.log(`  Cover page:        ${skipped.coverImage ? "text-only (image missing or decode-failed)" : "with cover art"}`);
console.log(`  Scene pages:       ${scenesSucceeded}/${story.scenes.length} rendered`);
console.log(`  Layout distribution (rendered):`);
console.log(`    classic:         ${layoutCounts.classic}`);
console.log(`    cinematic:       ${layoutCounts.cinematic}`);
console.log(`    asymmetric:      ${layoutCounts.asymmetric}`);
if (fallbacks.length > 0) {
  console.log(`  Fallbacks:`);
  fallbacks.forEach((f) => {
    const pageStr = String(f.page).padStart(2, "0");
    console.log(`    - page ${pageStr}: ${f.reason}`);
  });
}
if (skipped.pages.length > 0) {
  console.log(`  Skipped pages:`);
  skipped.pages.forEach((s) => {
    const pageStr = String(s.page).padStart(2, "0");
    console.log(`    - page ${pageStr}: ${s.reason}`);
  });
}
console.log(`  Output:            ${displayPath(outputPdfPath)} (${outputSizeKB} KB)`);
console.log();

// Exit code: 0 if cover + all 12 pages rendered cleanly, 1 if anything was
// skipped or rendered partially. Rationale: any skip = degraded book
// experience worth surfacing via exit code. Differentiates "all good" from
// "partial output but no fatal error." Fallbacks (cinematic→classic) do NOT
// affect exit code — they're a successful rendering, just with a different
// layout than the position-rule asked for.
const allRendered = !skipped.coverImage && scenesFailed === 0;
process.exit(allRendered ? 0 : 1);
