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

// ---- Generic single-page Puppeteer render (shared by cover + front matter) --
// Substitutes {{KEY}} placeholders from `subs` (HTML-escaped) into the
// template, then prints a one-page PDF + a screenshot PNG. Mirrors
// page-pipeline's renderPdfWithDynamicCss launch flags (PUPPETEER_LAUNCH_ARGS
// for --no-sandbox on Fly) + per-render temp-html hygiene.
export async function renderTemplatePage({ templateHtmlPath, pageSize, subs, outputDir, outName, rawSubs = {} }) {
  let html = fs.readFileSync(templateHtmlPath, "utf8");
  for (const [k, v] of Object.entries(subs)) html = html.replaceAll(`{{${k}}}`, escHtml(v));
  for (const [k, v] of Object.entries(rawSubs)) html = html.replaceAll(`{{${k}}}`, String(v)); // pre-escaped / numeric
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
export function buildDedicationSubs({ childName }) {
  return { DEDICATION: `For ${childName}, with love.` }; // auto-default; custom message = future wizard field
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
// Render a Variant-C cover from a hero image: auto-fit the title into the panel
// (interior's fitTextToRegion), substitute, render. (src-side twin of
// scripts/render-cover.mjs so the worker can call it.)
export async function renderCoverPage({ title, subtitle, imagePath, outputDir, outName = "cover" }) {
  const { config, htmlPath } = loadTemplate("cover-iter-1");
  const pageWpt = parseInches(config.rendering.pageSize.width) * 72;
  const pageHpt = parseInches(config.rendering.pageSize.height) * 72;
  const t = config.typography;
  const fit = await fitTextToRegion({
    text: title,
    region: { width: config.titleRegion.widthFrac * pageWpt, height: config.titleRegion.heightFrac * pageHpt },
    fontFamily: t.fontFamily, lineHeight: t.lineHeight, maxFontSize: t.maxFontSize, minFontSize: t.minFontSize, letterSpacing: t.letterSpacing,
  });
  const fontSize = fit.fits ? fit.fontSize : t.minFontSize;
  return renderTemplatePage({
    templateHtmlPath: htmlPath, pageSize: config.rendering.pageSize, outputDir, outName,
    subs: { TITLE: title, SUBTITLE: subtitle },
    rawSubs: { IMAGE_URL: pathToFileURL(imagePath).href, TITLE_FONT_SIZE: fontSize },
  });
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
export async function assembleFrontMatter({ story, childName, childAge, sheets, generatedAtIso, outputDir, withCover = true, coverImagePath = null }, deps = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  let cost = 0;
  const front = [];

  // Cover (paid unless an existing hero is reused).
  let heroPath = coverImagePath;
  if (withCover && !heroPath) {
    const buf = await generateCoverHero({ story, childName, childAge, sheets }, deps);
    cost += GEMINI_IMAGE_USD_PER_CALL;
    heroPath = path.join(outputDir, "cover-hero.png");
    fs.writeFileSync(heroPath, buf);
  }
  if (heroPath) {
    const cov = await renderCoverPage({ title: story.title, subtitle: `A story for ${childName}`, imagePath: heroPath, outputDir, outName: "00-cover" });
    front.push(cov.pdfPath);
  }

  // Title (recto) — $0.
  const ttl = await renderFrontMatterPage({ kind: "title", subs: buildTitleSubs({ title: story.title, childName }), outputDir, outName: "01-title" });
  front.push(ttl.pdfPath);

  // Back matter — $0.
  const ded = await renderFrontMatterPage({ kind: "dedication", subs: buildDedicationSubs({ childName }), outputDir, outName: "98-dedication" });
  const col = await renderFrontMatterPage({ kind: "colophon", subs: buildColophonSubs({ childName, generatedAtIso }), outputDir, outName: "99-colophon" });

  return { front, back: [ded.pdfPath, col.pdfPath], cost };
}
