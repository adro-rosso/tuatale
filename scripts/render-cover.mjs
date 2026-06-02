// scripts/render-cover.mjs
// Renders a front cover (Variant C) from a hero image + title + subtitle.
// The title auto-fits the panel width via the interior's fitTextToRegion
// (so any length sits cleanly). Exports renderCover() for reuse by the
// Part-4 paid driver; run directly for the Part-2 free mock (existing
// image placeholder, NO Gemini).

import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { fitTextToRegion } from "../src/auto-fit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function parseInches(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.endsWith("in")) return parseFloat(v);
  if (typeof v === "string" && v.endsWith("pt")) return parseFloat(v) / 72;
  return parseFloat(v);
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a Variant-C front cover.
 * @returns {Promise<{pdfPath, pngPath, fontSize, fits}>}
 */
export async function renderCover({ title, subtitle, imagePath, outputDir, configPath, outName = "cover" }) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const tplPath = path.join(path.dirname(configPath), config.rendering.templateHtmlPath);

  // Page dims → pt (1in = 72pt). titleRegion is fractions of the page.
  const pageWpt = parseInches(config.rendering.pageSize.width) * 72;
  const pageHpt = parseInches(config.rendering.pageSize.height) * 72;
  const region = {
    width: config.titleRegion.widthFrac * pageWpt,
    height: config.titleRegion.heightFrac * pageHpt,
  };

  // Auto-fit the title into the panel region. Clamp to minFontSize if even
  // that doesn't fit (graceful degradation — the cover still renders).
  const t = config.typography;
  const fit = await fitTextToRegion({
    text: title,
    region,
    fontFamily: t.fontFamily,
    lineHeight: t.lineHeight,
    maxFontSize: t.maxFontSize,
    minFontSize: t.minFontSize,
    letterSpacing: t.letterSpacing,
  });
  const fontSize = fit.fits ? fit.fontSize : t.minFontSize;
  if (!fit.fits) {
    console.warn(`  ⚠ "${title}" didn't fit even at minFontSize ${t.minFontSize}pt — clamped (still renders).`);
  }

  // Substitute template placeholders.
  let html = fs.readFileSync(tplPath, "utf8")
    .replace(/\{\{IMAGE_URL\}\}/g, pathToFileURL(imagePath).href)
    .replace(/\{\{TITLE\}\}/g, escHtml(title))
    .replace(/\{\{SUBTITLE\}\}/g, escHtml(subtitle))
    .replace(/\{\{TITLE_FONT_SIZE\}\}/g, String(fontSize));

  // Unique per-render temp path (D4 lesson — never a shared path).
  const tmp = path.join(os.tmpdir(), `daboo-cover-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html, "utf8");

  const wPx = Math.round(parseInches(config.rendering.pageSize.width) * 96);
  const hPx = Math.round(parseInches(config.rendering.pageSize.height) * 96);
  fs.mkdirSync(outputDir, { recursive: true });
  const pdfPath = path.join(outputDir, `${outName}.pdf`);
  const pngPath = path.join(outputDir, `${outName}.png`);

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: wPx, height: hPx });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: pdfPath,
      width: config.rendering.pageSize.width,
      height: config.rendering.pageSize.height,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
    });
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: wPx, height: hPx }, type: "png" });
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
  }
  return { pdfPath, pngPath, fontSize, fits: fit.fits };
}

// ---- Part-2 mock (run directly) -------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const CONFIG = path.join(ROOT, "templates", "cover-iter-1", "config.json");
  const HERO = path.join(ROOT, "output", "books", "2026-05-22-iris-1333", "pages", "page-09.png");
  const OUT = path.join(ROOT, "templates", "cover-iter-1", "test-output");

  if (!fs.existsSync(HERO)) { console.error(`Hero placeholder missing: ${HERO}`); process.exit(1); }

  console.log("Cover auto-fit mock ($0, existing image placeholder):");
  const cases = [
    { title: "Bo", subtitle: "A story for Bo", outName: "mock-short-bo" },
    { title: "Iris and the Wishing Star", subtitle: "A story for Iris", outName: "mock-medium-iris" },
    { title: "Anneliese and the Sunken Ship", subtitle: "A story for Anneliese", outName: "mock-long-anneliese" },
  ];
  for (const c of cases) {
    const r = await renderCover({
      title: c.title, subtitle: c.subtitle, imagePath: HERO,
      outputDir: OUT, configPath: CONFIG, outName: c.outName,
    });
    console.log(`  "${c.title}"  → fontSize ${r.fontSize}pt  (fits=${r.fits})  ${path.relative(ROOT, r.pngPath).replace(/\\/g, "/")}`);
  }
  console.log("\nDone. Mock covers in templates/cover-iter-1/test-output/.");
}
