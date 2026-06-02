// scripts/prototype-cover-layout.mjs
// $0 FRONT-COVER layout prototype. No Gemini spend. Canvas = current page
// aspect (11×8.5in → 1056×816px landscape). Hero art = an existing batch
// image (throwaway placeholder). Title overlaid in CSS (EB Garamond, the
// interior display face). Produces 3 surfaced comparison images:
//   1. Variant A — title in top negative space
//   2. Variant B vs C — lower-third: direct-on-art vs translucent panel
//   3. Length test — short "Bo" vs long "Anneliese and the Sunken Ship"
//
// Read-only except the throwaway _cover-prototype dir.

import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "templates", "_cover-prototype");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Hero placeholder — Iris 1333 page 9 (star climax, full-bleed landscape).
const HERO = path.join(ROOT, "output", "books", "2026-05-22-iris-1333", "pages", "page-09.png");
if (!fs.existsSync(HERO)) { console.error(`Hero image missing: ${HERO}`); process.exit(1); }
const HERO_URL = pathToFileURL(HERO).href;

const CANVAS_W = 1056, CANVAS_H = 816;  // 11×8.5in @ 96dpi

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// variant: "top" | "bottom-direct" | "bottom-panel"
function coverHtml({ title, byline, variant }) {
  // Per-variant title-zone CSS.
  let zoneCss, titleColor, bylineColor, panelCss = "", textShadow;
  if (variant === "top") {
    zoneCss = "top: 0; padding-top: 5%;";
    titleColor = "#FAF9F0"; bylineColor = "#FAF9F0";
    textShadow = "text-shadow: 0 2px 10px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5);";
  } else if (variant === "bottom-direct") {
    zoneCss = "bottom: 0; padding-bottom: 6%;";
    titleColor = "#FAF9F0"; bylineColor = "#FAF9F0";
    textShadow = "text-shadow: 0 2px 10px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.6);";
  } else { // bottom-panel
    zoneCss = "bottom: 0;";
    titleColor = "#1F1A14"; bylineColor = "#3D2418";
    textShadow = "";
    // Translucent cream panel like prompt-6's text band.
    panelCss = "background: rgba(240, 234, 219, 0.92); padding: 5% 8%;";
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
  @page { size: ${CANVAS_W}px ${CANVAS_H}px; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${CANVAS_W}px; height: ${CANVAS_H}px; overflow: hidden; }
  .cover { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; }
  .hero { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center center; display: block; }
  .title-zone {
    position: absolute; left: 0; width: 100%; box-sizing: border-box;
    text-align: center; ${zoneCss}
  }
  .panel-inner { ${panelCss} }
  .title {
    font-family: "EB Garamond", Garamond, serif; font-weight: 600;
    font-size: 60px; line-height: 1.12; margin: 0; letter-spacing: 0.01em;
    color: ${titleColor}; ${textShadow}
  }
  .byline {
    font-family: "EB Garamond", Garamond, serif; font-style: italic; font-weight: 400;
    font-size: 27px; margin: 14px 0 0 0; letter-spacing: 0.02em;
    color: ${bylineColor}; ${textShadow}
  }
</style></head>
<body><div class="cover">
  <img class="hero" src="${HERO_URL}" alt="">
  <div class="title-zone"><div class="panel-inner">
    <h1 class="title">${esc(title)}</h1>
    <p class="byline">${esc(byline)}</p>
  </div></div>
</div></body></html>`;
}

async function render(html) {
  const tmp = path.join(os.tmpdir(), `daboo-cover-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html, "utf8");
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: CANVAS_W, height: CANVAS_H });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H } });
  } finally {
    await browser.close();
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Composite N cover-buffers side by side with a title + per-panel labels.
async function strip(title, panels, panelW) {
  const scale = panelW / CANVAS_W;
  const panelH = Math.round(CANVAS_H * scale);
  const GAP = 14, PAD = 14, TITLE_H = 30, LABEL_H = 26;
  const totalW = panels.length * panelW + (panels.length - 1) * GAP + PAD * 2;
  const totalH = TITLE_H + LABEL_H + panelH + PAD * 2;
  const resized = await Promise.all(panels.map((p) => sharp(p.buf).resize(panelW, panelH, { fit: "fill" }).png().toBuffer()));
  const labelX = (i) => PAD + i * (panelW + GAP) + panelW / 2;
  const labels = panels.map((p, i) =>
    `<text x="${labelX(i)}" y="${TITLE_H + 18}" font-family="Arial" font-size="13" fill="#333" text-anchor="middle">${esc(p.label)}</text>`
  ).join("");
  const header = Buffer.from(
    `<svg width="${totalW}" height="${TITLE_H + LABEL_H + PAD}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="#fff"/>
       <text x="${totalW / 2}" y="21" font-family="Arial" font-size="17" font-weight="bold" fill="#111" text-anchor="middle">${esc(title)}</text>
       ${labels}
     </svg>`);
  const top = TITLE_H + LABEL_H + PAD;
  const comps = [{ input: header, top: 0, left: 0 }];
  resized.forEach((buf, i) => comps.push({ input: buf, top, left: PAD + i * (panelW + GAP) }));
  const outName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outPath = path.join(OUT_DIR, `cover-${outName}.png`);
  await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps).png().toFile(outPath);
  return outPath;
}

console.log("Rendering cover-layout variants ($0, no Gemini)...");
const TITLE = "Iris and the Wishing Star";

const aMed   = await render(coverHtml({ title: TITLE, byline: "A bedtime story for Iris", variant: "top" }));
const bDir   = await render(coverHtml({ title: TITLE, byline: "for Iris", variant: "bottom-direct" }));
const cPanel = await render(coverHtml({ title: TITLE, byline: "for Iris", variant: "bottom-panel" }));
const short  = await render(coverHtml({ title: "Bo", byline: "A bedtime story for Bo", variant: "top" }));
const long   = await render(coverHtml({ title: "Anneliese and the Sunken Ship", byline: "A bedtime story for Anneliese", variant: "top" }));

const img1 = await strip("Variant A — title in top negative space", [{ buf: aMed, label: "top band, cream text + shadow on sky" }], 760);
const img2 = await strip("Variant B vs C — lower-third placement", [
  { buf: bDir,   label: "B: direct on art (cream + shadow)" },
  { buf: cPanel, label: "C: translucent cream panel (ink text)" },
], 600);
const img3 = await strip("Length test — short vs long title (variant A treatment)", [
  { buf: short, label: '"Bo" (short)' },
  { buf: long,  label: '"Anneliese and the Sunken Ship" (long, wraps)' },
], 600);

console.log();
console.log("Done. Surface:");
for (const p of [img1, img2, img3]) console.log("  " + path.relative(ROOT, p).replace(/\\/g, "/"));
console.log();
