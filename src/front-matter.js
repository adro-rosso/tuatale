// src/front-matter.js — Stage B.1 book furniture (front/back matter).
//
// Vendor-INDEPENDENT, $0 typographic pages (title / dedication / colophon) +
// the cover render, assembled around the 12 story pages so the delivered
// book.pdf is a real book: cover -> title -> [story x12] -> dedication ->
// colophon. Lives in src/ (NOT scripts/) so the Fly worker image — which COPYs
// src/ + templates/ but not scripts/ — can render them at gen time.
//
// The text pages call NO image model ($0). The cover is the ONLY paid piece
// (~$0.04, one Gemini hero gen), generated here from the same character sheets
// the interior used. All page metrics use a PROVISIONAL safe inset (central
// ~80%); the true trim/bleed/safe-area is vendor-gated (Stage B.2).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { fitTextToRegion } from "./auto-fit.js";
import { maskName } from "./text-utils.js";
import { generateImage as realGenerateImage } from "./gemini.js";
import { pickTitleColor } from "./cover-title-color.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const GEMINI_IMAGE_USD_PER_CALL = 0.04;

function parseInches(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.endsWith("in")) return parseFloat(v);
  if (typeof v === "string" && v.endsWith("pt")) return parseFloat(v) / 72;
  return parseFloat(v);
}
function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Generic single-page Puppeteer render ---------------------------------
// Prints a one-page PDF + a screenshot PNG from a full HTML string. Mirrors
// page-pipeline's renderPdfWithDynamicCss launch flags (PUPPETEER_LAUNCH_ARGS
// for --no-sandbox on Fly) + per-render temp-html hygiene. Shared by the
// {{KEY}}-substitution front-matter pages (renderTemplatePage) AND the cover
// builders (which assemble their HTML in-code rather than from a disk template).
export async function renderHtmlToPdf({ html, pageSize, outputDir, outName }) {
  const tmp = path.join(os.tmpdir(), `daboo-fm-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html, "utf8");

  fs.mkdirSync(outputDir, { recursive: true });
  const pdfPath = path.join(outputDir, `${outName}.pdf`);
  const pngPath = path.join(outputDir, `${outName}.png`);
  const wPx = Math.round(parseInches(pageSize.width) * 96);
  const hPx = Math.round(parseInches(pageSize.height) * 96);

  const launchArgs = process.env.PUPPETEER_LAUNCH_ARGS
    ? process.env.PUPPETEER_LAUNCH_ARGS.split(/\s+/).filter(Boolean)
    : [];
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: launchArgs });
    const page = await browser.newPage();
    await page.setViewport({ width: wPx, height: hPx });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: pdfPath, width: pageSize.width, height: pageSize.height, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: wPx, height: hPx }, type: "png" });
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
  }
  return { pdfPath, pngPath };
}

// Substitutes {{KEY}} placeholders from `subs` (HTML-escaped) + `rawSubs`
// (pre-escaped / numeric) into a disk template, then renders it.
export async function renderTemplatePage({ templateHtmlPath, pageSize, subs, outputDir, outName, rawSubs = {} }) {
  let html = fs.readFileSync(templateHtmlPath, "utf8");
  for (const [k, v] of Object.entries(subs)) html = html.replaceAll(`{{${k}}}`, escHtml(v));
  for (const [k, v] of Object.entries(rawSubs)) html = html.replaceAll(`{{${k}}}`, String(v));
  return renderHtmlToPdf({ html, pageSize, outputDir, outName });
}

function loadTemplate(dir) {
  const config = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, dir, "config.json"), "utf8"));
  return { config, htmlPath: path.join(TEMPLATES_DIR, dir, config.rendering.templateHtmlPath) };
}

// ---- $0 text pages ---------------------------------------------------------
// gen date formatted from a passed ISO string (NO Date.now() — deterministic;
// the caller supplies meta.generatedAt so a re-run reproduces byte-identically).
export function buildTitleSubs({ title, childName }) {
  return { TITLE: title, SUBTITLE: `A story for ${childName}` };
}
// Per-vibe default dedication for ADULT books. Keyed by the ADULT_VIBES enum
// (romantic/milestone/roast/adventure). The child default "For X, with love." is
// register-blind: "with love" is wrong on an affectionate roast and flat on an
// adventure, and adult books carry a register (the vibe) that child books don't.
// NO em dash anywhere (house style — matches stripNarrativeDashes): milestone uses a
// period, not a dash.
const ADULT_DEDICATIONS = {
  romantic: (name) => `For ${name}, with love.`,
  milestone: (name) => `For ${name}. Here's to you.`,
  roast: (name) => `For ${name}. You had this coming.`,
  adventure: (name) => `For ${name}, and the wrong turns worth taking.`,
};

// Custom dedication if the parent wrote one, else the auto-default. `message`
// is the parent's free text (already Zod-capped at 120 on the website; clamped
// here too as a defensive boundary). renderTemplatePage HTML-escapes it.
//
// adultMode + vibe are the ONLY new inputs; both default to the child/pet path so
// output is BYTE-IDENTICAL when adultMode is false. The gate is `adultMode && vibe`,
// never `vibe` alone: PET vibes and ADULT vibes share the value 'adventure', so a pet
// book must NOT pick up the adult adventure line. A custom parent-written dedication
// still always wins, for every audience.
export function buildDedicationSubs({ childName, message = null, adultMode = false, vibe = null }) {
  const custom = typeof message === "string" ? message.trim().slice(0, 120) : "";
  if (custom) return { DEDICATION: custom };
  if (adultMode && vibe && ADULT_DEDICATIONS[vibe]) {
    return { DEDICATION: ADULT_DEDICATIONS[vibe](childName) };
  }
  return { DEDICATION: `For ${childName}, with love.` };
}
export function buildColophonSubs({ childName, generatedAtIso }) {
  const year = (generatedAtIso || "").slice(0, 4) || "";
  const date = (generatedAtIso || "").slice(0, 10) || "";
  return {
    COPYRIGHT: `© ${year} Tuatale`,
    MADE_FOR: `Made for ${childName}`,
    GENERATED: date ? `Generated ${date}` : "",
  };
}

export async function renderFrontMatterPage({ kind, subs, outputDir, outName }) {
  const dir = { title: "title-iter-1", dedication: "dedication-iter-1", colophon: "colophon-iter-1" }[kind];
  if (!dir) throw new Error(`renderFrontMatterPage: unknown kind "${kind}"`);
  const { config, htmlPath } = loadTemplate(dir);
  return renderTemplatePage({ templateHtmlPath: htmlPath, pageSize: config.rendering.pageSize, subs, outputDir, outName: outName ?? kind });
}

// ---- Cover (the one paid piece) --------------------------------------------
// Cover typography redesign (2026-07-07). Two title treatments, selectable per
// cover via `coverTitleStyle` (the review-UI toggle will drive this later):
//   'integrated' (default) — HYBRID: a warm chunky Fredoka title sitting on the
//       hero's reserved calm zone over a SOFTENED gradient scrim (darkens the
//       art as little as possible while guaranteeing title contrast on any hero).
//       titleColor 'auto' (DEFAULT) samples the hero's title zone → espresso on a
//       light zone, cream on a dark/ambiguous one (cover-title-color.js). 'cream'
//       (soft dark scrim, any hero) and 'espresso' (soft light scrim, light zones
//       only) force a fixed colour; cream is the fallback within 'auto'.
//   'band' — the redesigned Treatment-C: an inset rounded cream "plate" (soft
//       shadow, not a flat full-width rectangle) with the same warm Fredoka.
// Both replace the old thin EB-Garamond serif. "for {name}" is the smallest
// element; "A Tuatale Book" is a legible mark (bottom colophon on integrated,
// inside the plate on band). Titles hand-balanced to <=2 lines (no orphans).
const COVER_PAGE_SIZE = { width: "11in", height: "8.5in" };
const TUATALE_MARK = "A Tuatale Book";
const COVER_FONTS_LINK =
  `<link rel="preconnect" href="https://fonts.googleapis.com">` +
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
  `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:ital,wght@0,700;1,600&display=swap" rel="stylesheet">`;
const COVER_BASE_CSS = `
  @page { size: 11in 8.5in; margin: 0; }
  html,body{margin:0;padding:0;width:11in;height:8.5in;overflow:hidden;background:#FAF9F0;}
  .cover{position:relative;width:11in;height:8.5in;}
  .hero{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center center;display:block;}`;

// Balance a title into <=2 lines at the word boundary minimising the two lines'
// character-count difference — avoids an orphan trailing word. Titles of <=3
// words stay on one line.
export function balanceTitleLines(title) {
  const words = String(title ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return [words.join(" ")];
  let best = { i: 1, diff: Infinity };
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const diff = Math.abs(left.length - right.length);
    if (diff < best.diff) best = { i, diff };
  }
  return [words.slice(0, best.i).join(" "), words.slice(best.i).join(" ")];
}

// Largest Fredoka size at which the longest balanced line fits the title band
// width. measureText loads Fredoka@400 (a touch narrower than the rendered 700),
// so the region is already kept conservative by the caller.
async function fitCoverTitleSize(lines, { maxFontSize, minFontSize, regionWidthPt }) {
  const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b), "");
  const fit = await fitTextToRegion({
    text: longest,
    region: { width: regionWidthPt, height: maxFontSize * 2 },
    fontFamily: "Fredoka", lineHeight: 1.0, maxFontSize, minFontSize, letterSpacing: "0",
  });
  return fit.fits ? fit.fontSize : minFontSize;
}

function buildIntegratedCoverHtml({ heroUrl, linesHtml, name, fontSizePt, titleColor }) {
  const cream = titleColor !== "espresso";
  // Softened vs prototype B: peak opacity ~0.46 (was 0.66), feathered to nothing.
  const scrim = cream
    ? "linear-gradient(to top, rgba(18,12,6,0.46) 0%, rgba(18,12,6,0.30) 26%, rgba(18,12,6,0.10) 58%, rgba(18,12,6,0) 100%)"
    : "linear-gradient(to top, rgba(250,246,235,0.62) 0%, rgba(250,246,235,0.42) 28%, rgba(250,246,235,0.12) 62%, rgba(250,246,235,0) 100%)";
  const titleCol = cream ? "#FBF3E1" : "#2B1A0D";
  const titleShadow = cream
    ? "0 1px 3px rgba(0,0,0,.55),0 2px 12px rgba(0,0,0,.38)"
    : "0 1px 2px rgba(255,252,244,.65),0 2px 10px rgba(255,252,244,.45)";
  const nameCol = cream ? "#ECDCBF" : "#6E4A2C";
  const markCol = cream ? "#F3E7CE" : "#5A3D24";
  const softShadow = cream ? "0 1px 3px rgba(0,0,0,.5)" : "0 1px 2px rgba(255,252,244,.6)";
  // The colophon can sit on a very light lower zone (soft scrim barely darkens it),
  // where a light cream mark goes faint. Give it a stronger dark outline-glow so it
  // reads on ANY hero (2026-07-07 colophon fix); espresso keeps a light halo.
  const markShadow = cream ? "0 1px 2px rgba(0,0,0,.72),0 0 7px rgba(0,0,0,.5)" : "0 1px 2px rgba(255,252,244,.65)";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${COVER_FONTS_LINK}<style>${COVER_BASE_CSS}
  .scrim{position:absolute;left:0;right:0;bottom:0;height:42%;background:${scrim};}
  .lower{position:absolute;left:7%;right:7%;bottom:0.66in;text-align:center;}
  .title{font-family:'Fredoka',sans-serif;font-weight:700;font-size:${fontSizePt}pt;line-height:1.0;margin:0;color:${titleCol};text-shadow:${titleShadow};}
  .forname{font-family:'Nunito',sans-serif;font-style:italic;font-weight:600;font-size:15pt;margin:0.15in 0 0;color:${nameCol};text-shadow:${softShadow};}
  .mark{position:absolute;left:0;right:0;bottom:0.32in;text-align:center;font-family:'Nunito',sans-serif;font-weight:700;font-size:11.5pt;letter-spacing:0.32em;text-transform:uppercase;color:${markCol};text-shadow:${markShadow};}
  </style></head><body><div class="cover">
    <img class="hero" src="${heroUrl}" alt="">
    <div class="scrim"></div>
    <div class="lower"><h1 class="title">${linesHtml}</h1><p class="forname">for ${escHtml(name)}</p></div>
    <div class="mark">${TUATALE_MARK}</div>
  </div></body></html>`;
}

function buildBandCoverHtml({ heroUrl, linesHtml, name, fontSizePt }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${COVER_FONTS_LINK}<style>${COVER_BASE_CSS}
  .plate{position:absolute;left:8%;right:8%;bottom:0.44in;padding:0.24in 0.5in 0.32in;text-align:center;background:linear-gradient(to bottom, rgba(248,242,227,0.975), rgba(242,233,212,0.975));border-radius:26px;box-shadow:0 12px 34px rgba(44,30,14,.30),0 2px 7px rgba(44,30,14,.20);}
  .mark{font-family:'Nunito',sans-serif;font-weight:700;font-size:11pt;letter-spacing:0.32em;text-transform:uppercase;color:#A2825F;margin:0 0 0.08in;}
  .title{font-family:'Fredoka',sans-serif;font-weight:700;font-size:${fontSizePt}pt;line-height:1.0;margin:0;color:#2B1A0D;}
  .forname{font-family:'Nunito',sans-serif;font-style:italic;font-weight:600;font-size:13pt;margin:0.1in 0 0;color:#7A5636;}
  </style></head><body><div class="cover">
    <img class="hero" src="${heroUrl}" alt="">
    <div class="plate"><div class="mark">${TUATALE_MARK}</div><h1 class="title">${linesHtml}</h1><p class="forname">for ${escHtml(name)}</p></div>
  </div></body></html>`;
}

export async function renderCoverPage({ title, name, imagePath, outputDir, outName = "cover", coverTitleStyle = "integrated", titleColor = "auto", subtitle = null }) {
  // Backward-compat: older callers passed subtitle "A story for X" — derive name.
  if (!name && subtitle) {
    const m = /for\s+(.+?)\.?$/i.exec(subtitle);
    name = m ? m[1].trim() : subtitle;
  }
  const lines = balanceTitleLines(title);
  const linesHtml = lines.map(escHtml).join("<br>");
  const pageWpt = parseInches(COVER_PAGE_SIZE.width) * 72;
  const isBand = coverTitleStyle === "band";
  const maxFontSize = isBand ? 50 : 54;
  const regionWidthPt = pageWpt * (isBand ? 0.80 : 0.82);
  const fontSizePt = await fitCoverTitleSize(lines, { maxFontSize, minFontSize: 28, regionWidthPt });
  const heroUrl = pathToFileURL(imagePath).href;
  // 'auto' → sample the hero's title zone and pick espresso (light) / cream (dark
  // or ambiguous). Default stays the locked 'cream'. Ignored for the band path.
  const resolvedColor = titleColor === "auto" ? await pickTitleColor(imagePath) : titleColor;
  const html = isBand
    ? buildBandCoverHtml({ heroUrl, linesHtml, name, fontSizePt })
    : buildIntegratedCoverHtml({ heroUrl, linesHtml, name, fontSizePt, titleColor: resolvedColor });
  return renderHtmlToPdf({ html, pageSize: COVER_PAGE_SIZE, outputDir, outName });
}

// Generate the cover hero image (~$0.04). Reuses the SAME reference sheets the
// interior used + the cover-iter-1 composition + Sonnet's per-story
// cover_concept. Returns the image Buffer. Single-protagonist shape (launch).
export async function generateCoverHero({ story, childName, childAge, sheets }, deps = {}) {
  const { generateImage = realGenerateImage } = deps;
  const { config } = loadTemplate("cover-iter-1");
  const ig = config.imageGeneration;
  if (!story?.cover_concept) throw new Error("generateCoverHero: story.cover_concept missing");
  const charDesc = maskName(story.character, childName);
  // style: post-W-D the style line comes off the story (pageStyle), not a
  // template styleOverride. Fall back to story.style for older stories.
  const styleLine = story.pageStyle || story.style;
  const prompt = [
    `Subject: a ${childAge}-year-old child.`,
    `Appearance: ${charDesc}.`,
    `Style: ${styleLine}.`,
    `Composition: ${ig.customCompositionRules}`,
    `Template composition: ${ig.compositionPromptTemplate}`,
    `Avoid: ${story.negative_prompt}.`,
  ].join("\n") + `\n\nScene: ${story.cover_concept}\n\nUse the provided reference images of the character to keep their appearance, clothing, and proportions consistent.`;
  return generateImage(prompt, sheets, { aspectRatio: ig.aspectRatio }, { callKind: "cover_gen", subjectName: childName });
}

/**
 * Assemble the front/back matter around the story pages. Returns ordered PDF
 * path lists to merge as: [...front, ...story, ...back], plus the Gemini cost.
 * front = [cover, title]; back = [dedication, colophon].
 *
 * withCover:true generates the cover hero (~$0.04). All text pages are $0.
 * Deps injectable for tests/preview ($0): pass a stub generateImage, or
 * withCover:false + a coverImagePath to reuse an existing hero (the harness path).
 */
export async function assembleFrontMatter({ story, childName, childAge, sheets, generatedAtIso, dedicationMessage = null, outputDir, withCover = true, coverImagePath = null, coverTitleStyle = "integrated", adultMode = false, vibe = null }, deps = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  let cost = 0;
  const front = [];

  // Cover (paid unless an existing hero is reused). coverTitleStyle selects the
  // typographic treatment (integrated hybrid default | band); the review-UI
  // toggle will thread a per-cover choice here later.
  let heroPath = coverImagePath;
  if (withCover && !heroPath) {
    const buf = await generateCoverHero({ story, childName, childAge, sheets }, deps);
    cost += GEMINI_IMAGE_USD_PER_CALL;
    heroPath = path.join(outputDir, "cover-hero.png");
    fs.writeFileSync(heroPath, buf);
  }
  if (heroPath) {
    const cov = await renderCoverPage({ title: story.title, name: childName, imagePath: heroPath, outputDir, outName: "00-cover", coverTitleStyle });
    front.push(cov.pdfPath);
  }

  // Title (recto) — $0.
  const ttl = await renderFrontMatterPage({ kind: "title", subs: buildTitleSubs({ title: story.title, childName }), outputDir, outName: "01-title" });
  front.push(ttl.pdfPath);

  // Back matter — $0.
  const ded = await renderFrontMatterPage({ kind: "dedication", subs: buildDedicationSubs({ childName, message: dedicationMessage, adultMode, vibe }), outputDir, outName: "98-dedication" });
  const col = await renderFrontMatterPage({ kind: "colophon", subs: buildColophonSubs({ childName, generatedAtIso }), outputDir, outName: "99-colophon" });

  return { front, back: [ded.pdfPath, col.pdfPath], cost };
}
