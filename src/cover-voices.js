// src/cover-voices.js — the cover system (2026-10-27).
//
// A cover = a VOICE (title lettering, chosen by the book's energy × the child's age band,
// each copied from a real picture-book cover Adro approved) × a PLACEMENT (where the title
// lives and how the hero is composed for it) × a PALETTE colour (per energy, hash-picked).
// Every output is viewer-proof by construction: solid fills, borders, clip-path polygons,
// text strokes via -webkit-text-stroke + paint-order, duplicated text for hard shadows —
// NO gradients, NO transparency, NO blur, NO masks (Edge's PDF engine drops those).
//
// Pure: no I/O. front-matter.js renders the HTML this module builds.

// ---------------------------------------------------------------------------
// Energies, age bands, selection
// ---------------------------------------------------------------------------
export const COVER_ENERGIES = ["gentle", "wonder", "playful"];
export const COVER_AGE_BANDS = ["3-5", "5-7", "7-9"];

/** FNV-1a 32-bit over a string → unsigned int. Deterministic per book. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Map what we know about a book to an energy. Story-gen's `cover_energy` wins; pet/adult
 * vibes map next; default "wonder" (the middle register, never wrong for an adventure).
 */
export function coverEnergyFor({ coverEnergy = null, vibe = null } = {}) {
  if (COVER_ENERGIES.includes(coverEnergy)) return coverEnergy;
  const byVibe = { happy: "playful", adventure: "wonder", tribute: "gentle", memorial: "gentle", romantic: "gentle", milestone: "gentle", roast: "playful" };
  if (vibe && byVibe[vibe]) return byVibe[vibe];
  return "wonder";
}

export function ageBandFor(ageRange) {
  return COVER_AGE_BANDS.includes(ageRange) ? ageRange : "5-7";
}

/** Voice key for an energy × band. */
export function selectCoverVoice({ energy, ageRange }) {
  return `${coverEnergyFor({ coverEnergy: energy })}-${ageBandFor(ageRange)}`;
}

// ---------------------------------------------------------------------------
// Palettes (per energy). `ink` = text colour that reads on that fill.
// ---------------------------------------------------------------------------
const CREAM = "#F6EAD8", ESP = "#2B1A0D";
export const COVER_PALETTES = {
  gentle:  [{ fill: "#6B7A3F", ink: CREAM, name: "sage" }, { fill: "#4F6D8C", ink: CREAM, name: "dusk" }, { fill: "#B8741A", ink: CREAM, name: "gold" }, { fill: "#1F6F78", ink: CREAM, name: "teal" }],
  wonder:  [{ fill: "#4F6D8C", ink: CREAM, name: "dusk" }, { fill: "#1F6F78", ink: CREAM, name: "teal" }, { fill: "#17244A", ink: CREAM, name: "night" }],
  playful: [{ fill: "#F2C230", ink: "#1E1A16", name: "sun" }, { fill: "#B5452F", ink: "#FFFFFF", name: "brick" }, { fill: "#1F6F78", ink: CREAM, name: "teal" }],
};

// ---------------------------------------------------------------------------
// Voices. Each: the real cover it follows, the Google Fonts it needs (TrueType-outline
// families only — CFF/OTF would embed as Type 3), and a builder that returns the title
// block HTML. The builder receives `ctx`:
//   { title, name, lines (string[]), ink ("dark"|"light": what reads on the background),
//     align ("left"|"center"), fill (background colour the block sits on, or null for art) }
// Lines inside the block are sized in EM so the in-page fitter scales the whole block.
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// NOTE: never use text strokes on a rendered cover (Type 3 fonts in the PDF); lintCoverHtml rejects them.
const joinLines = (lines, cls = "") => lines.map((l) => `<div class="ln ${cls}">${esc(l)}</div>`).join("");

export const COVER_VOICES = {
  "gentle-3-5": {
    name: "Peace at Last", ref: "Jill Murphy, Peace at Last (1980)",
    fonts: ["Fraunces:ital,wght@0,600;0,700;1,600"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? CREAM : "#B8741A", sub = ink === "light" ? "#EADFC6" : "#8A5612";
      return `<div class="title" style="font-family:'Fraunces',serif;font-weight:700;color:${col};line-height:1.02;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-style:italic;font-weight:600;font-size:.34em;margin-top:.22em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
  "gentle-5-7": {
    name: "Guess How Much I Love You", ref: "McBratney / Jeram (1994)",
    fonts: ["Sorts+Mill+Goudy:ital@0;1"],
    build: ({ lines, name, ink, align }) => {
      const a = ink === "light" ? "#CFE3E6" : "#2E6A70", b = ink === "light" ? "#F3C9BC" : "#A8432E", sub = ink === "light" ? "#EADFC6" : "#4A3A2A";
      const rows = lines.map((l, i) => `<div class="ln" style="color:${i === lines.length - 1 ? b : a};font-size:${i === lines.length - 1 ? 1.1 : 0.9}em;letter-spacing:.06em">${esc(l).toUpperCase()}</div>`).join("");
      return `<div class="title" style="font-family:'Sorts Mill Goudy',serif;line-height:1.05;text-align:${align}">${rows}` +
        `<div class="sub" style="font-style:italic;font-size:.36em;margin-top:.3em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
  "gentle-7-9": {
    name: "Owl Babies", ref: "Waddell / Benson (1992)",
    fonts: ["Alegreya+SC:wght@500;700"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? CREAM : "#2A2216", sub = ink === "light" ? "#EADFC6" : "#3F3424";
      return `<div class="title" style="font-family:'Alegreya SC',serif;font-weight:700;letter-spacing:.07em;color:${col};line-height:1.04;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-weight:500;font-size:.3em;letter-spacing:.2em;margin-top:.4em;color:${sub}">A story for ${esc(name)}</div></div>`;
    },
  },
  "wonder-3-5": {
    name: "We're Going on a Bear Hunt", ref: "Rosen / Oxenbury (1989)",
    fonts: ["Fraunces:ital,wght@0,600;0,700;1,600;1,700"],
    // One ink only (Adro, 2026-10-27: no rainbow lettering; subtle contrast at most).
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? CREAM : "#4F5F7A", sub = ink === "light" ? "#EADFC6" : "#5B4A36";
      return `<div class="title" style="font-family:'Fraunces',serif;font-style:italic;font-weight:700;color:${col};line-height:1.05;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-weight:600;font-size:.36em;margin-top:.2em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
  "wonder-5-7": {
    name: "Lost and Found", ref: "Oliver Jeffers (2005)",
    fonts: ["Patrick+Hand"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? "#F2E9D6" : "#6B5A3C", sub = ink === "light" ? "#D9CFB8" : "#7E6C4C";
      const rows = lines.map((l, i) => `<div class="ln" style="transform:rotate(${i % 2 ? 1 : -1.5}deg);margin-left:${i % 2 ? 0.08 : 0}em;font-size:${i === lines.length - 1 ? 1.12 : 0.95}em">${esc(l)}</div>`).join("");
      return `<div class="title" style="font-family:'Patrick Hand',cursive;color:${col};line-height:1.0;text-align:${align}">${rows}` +
        `<div class="sub" style="font-size:.32em;letter-spacing:.06em;margin-top:.3em;margin-left:${align === "left" ? ".3em" : 0};color:${sub}">a story for ${esc(name)}</div></div>`;
    },
  },
  "wonder-7-9": {
    name: "Where the Wild Things Are", ref: "Maurice Sendak (1963)",
    fonts: ["Oswald:wght@600;700"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? CREAM : "#3A2415", sub = ink === "light" ? "#EADFC6" : "#5A4634";
      return `<div class="title" style="font-family:'Oswald',sans-serif;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${col};line-height:1.06;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-weight:600;font-size:.28em;letter-spacing:.24em;text-transform:uppercase;margin-top:.45em;color:${sub}">A story for ${esc(name)}</div></div>`;
    },
  },
  "playful-3-5": {
    name: "Dear Zoo", ref: "Rod Campbell (1982)",
    fonts: ["Arvo:wght@700"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? "#FFFFFF" : "#1E1A16", sub = ink === "light" ? "#F6EAD8" : "#1E1A16";
      return `<div class="title" style="font-family:'Arvo',serif;font-weight:700;color:${col};line-height:1.0;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-size:.36em;margin-top:.3em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
  "playful-5-7": {
    name: "The Tiger Who Came to Tea", ref: "Judith Kerr (1968)",
    fonts: ["Varela+Round"],
    build: ({ lines, name, ink, align }) => {
      const col = ink === "light" ? "#FFFFFF" : "#1E1A16", sub = ink === "light" ? "#F6EAD8" : "#3A3028";
      return `<div class="title" style="font-family:'Varela Round',sans-serif;color:${col};line-height:1.08;text-align:${align}">${joinLines(lines)}` +
        `<div class="sub" style="font-size:.38em;margin-top:.22em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
  "playful-7-9": {
    name: "The Day the Crayons Quit", ref: "Daywalt / Jeffers (2013)",
    fonts: ["Gochi+Hand"],
    build: ({ lines, name, ink, align }) => {
      const cols = ink === "light" ? ["#9EC2F0", "#A9DCA9", "#F4A28F", "#F7C86B"] : ["#2C5DA8", "#3E8E41", "#D2492F", "#E08A1E"];
      let k = 0;
      const rows = lines.map((l, i) => {
        const words = l.split(" ").map((w) => { const small = /^(and|the|of|a|an|to|in|on|at|with|for|my)$/i.test(w);
          return `<span style="display:inline-block;color:${cols[k++ % cols.length]};font-size:${small ? .62 : 1}em;transform:rotate(${(k % 2 ? -1.5 : 1.5)}deg)">${esc(small ? w : w.toUpperCase())}</span>`; }).join(" ");
        return `<div class="ln" style="font-size:${i === lines.length - 1 ? 1.08 : 0.98}em">${words}</div>`;
      }).join("");
      const sub = ink === "light" ? "#DCCBEA" : "#7A4FA0";
      return `<div class="title" style="font-family:'Gochi Hand',cursive;line-height:1.02;text-align:${align}">${rows}` +
        `<div class="sub" style="font-size:.36em;margin-top:.2em;color:${sub}">for ${esc(name)}</div></div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Title line breaking
// ---------------------------------------------------------------------------
/** ≤2 balanced lines (wide zones). Titles of ≤3 words stay on one line. */
export function balanceTwoLines(title) {
  const words = String(title).trim().split(/\s+/);
  if (words.length <= 3) return [words.join(" ")];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const d = Math.abs(a.length - b.length);
    if (!best || d < best.d) best = { d, lines: [a, b] };
  }
  return best.lines;
}
/** Narrow zones (columns, badges): stack words, joining short words with a neighbour, ≤5 lines. */
export function stackLines(title, maxChars = 9) {
  const words = String(title).trim().split(/\s+/);
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= maxChars) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  while (lines.length > 5) { const i = lines.reduce((m, _, j) => (lines[j].length + lines[j + 1]?.length ?? 99) < (lines[m].length + (lines[m + 1]?.length ?? 99)) ? j : m, 0); lines.splice(i, 2, lines[i] + " " + lines[i + 1]); }
  return lines;
}

// ---------------------------------------------------------------------------
// Placements. Each: hero composition kind + aspect ratio, and a layout builder that returns
// the full page body HTML given { heroUrl, titleHtml, palette, mark }.
// Title blocks carry data-fit="<max-font-px>|<min-font-px>" and sit inside a fixed-size zone
// (width + height); the in-page fitter (COVER_FIT_SCRIPT) shrinks the block until it fits both.
// Page is 1056×816 CSS px (11×8.5in at 96dpi); fractions below are of the page.
// ---------------------------------------------------------------------------
const MARK = (extra = "") => `<div class="mark" style="${extra}">A Tuatale Book</div>`;
const heroImg = (url, style) => `<img class="hero" src="${url}" alt="" style="${style}">`;
// Mark over art: a solid cream pill (a text STROKE would make Chromium emit the glyphs as a Type 3 font).
const lightMark = `color:${ESP};background:${CREAM};padding:.55em .9em;border-radius:2em;`;

export const COVER_PLACEMENTS = {
  sky: {
    name: "Sky title", ref: "Donaldson/Scheffler standard; Lost and Found; Where the Wild Things Are",
    hero: "sky", aspectRatio: "4:3", titleInk: "dark",
    build: ({ heroUrl, titleHtml, align }) =>
      `${heroImg(heroUrl, "inset:0;width:100%;height:100%")}` +
      `<div class="zone" data-fit="120|52" style="position:absolute;left:7%;${align === "left" ? "width:70%" : "right:7%"};top:5%;height:38%">${titleHtml}</div>` +
      MARK(`right:4%;bottom:3.5%;${lightMark}`),
  },
  "column-left": {
    name: "Side column", ref: "The Cat in the Hat; Hooray Heroes landscape",
    hero: "portrait", aspectRatio: "3:4", titleInk: "palette", narrow: true,
    build: ({ heroUrl, titleHtml, palette, torn }) =>
      `${heroImg(heroUrl, "left:38%;top:0;width:62%;height:100%;object-position:50% 20%")}` +
      `<div style="position:absolute;left:0;top:0;width:40.5%;height:100%;background:${palette.fill};${torn ? "clip-path:polygon(0 0,100% 0,97% 12%,99% 26%,96% 40%,99% 55%,96% 70%,98% 84%,96% 100%,0 100%)" : ""}"></div>` +
      `<div class="zone" data-fit="104|40" style="position:absolute;left:4.5%;width:31.5%;top:8%;height:74%">${titleHtml}</div>` +
      MARK(`left:4.5%;bottom:4%;color:${palette.ink}`),
  },
  "column-right": {
    name: "Torn column right", ref: "Hooray Heroes landscape lockup",
    hero: "portrait-left", aspectRatio: "3:4", titleInk: "dark", narrow: true,
    build: ({ heroUrl, titleHtml }) =>
      `${heroImg(heroUrl, "left:0;top:0;width:62%;height:100%;object-position:50% 20%")}` +
      `<div style="position:absolute;right:0;top:0;width:41%;height:100%;background:#FBF4E4;clip-path:polygon(4% 0,100% 0,100% 100%,2% 100%,5% 86%,2% 72%,6% 58%,3% 44%,6% 30%,2% 16%)"></div>` +
      `<div class="zone" data-fit="100|40" style="position:absolute;right:4%;width:31%;top:9%;height:74%">${titleHtml}</div>` +
      MARK(`right:4%;bottom:4%;color:#5A4634`),
  },
  band: {
    name: "Bottom band", ref: "Supertato; Possum Magic; Bluey; Wild Things byline strip",
    hero: "stage", aspectRatio: "16:9", titleInk: "band",
    build: ({ heroUrl, titleHtml, bandFill, bandInk }) =>
      `${heroImg(heroUrl, "left:0;top:0;width:100%;height:72%;object-position:center 45%")}` +
      `<div style="position:absolute;left:0;right:0;bottom:0;height:28%;background:${bandFill}"></div>` +
      `<div class="zone centred" data-fit="84|34" style="position:absolute;left:5%;right:5%;bottom:3.5%;height:24%">${titleHtml}</div>` +
      MARK(`right:4%;bottom:3%;color:${bandInk}`),
  },
  plaque: {
    name: "Oval plaque", ref: "Each Peach Pear Plum",
    hero: "stage-right", aspectRatio: "16:9", titleInk: "dark", narrowish: true,
    build: ({ heroUrl, titleHtml }) =>
      `${heroImg(heroUrl, "inset:0;width:100%;height:100%;object-position:100% 60%")}` +
      `<div style="position:absolute;left:31%;top:26%;width:600px;height:290px;transform:translate(-50%,-50%);border-radius:50%;background:#DCEAF2;border:8px solid ${CREAM}"></div>` +
      `<div class="zone centred" data-fit="60|28" style="position:absolute;left:31%;top:26%;width:470px;transform:translate(-50%,-50%);height:220px">${titleHtml}</div>` +
      MARK(`right:4%;bottom:3.5%;${lightMark}`),
  },
  spine: {
    name: "Spine strip + top title", ref: "Little Golden Books; Ladybird",
    hero: "sky", aspectRatio: "4:3", titleInk: "dark",
    build: ({ heroUrl, titleHtml, palette }) =>
      `${heroImg(heroUrl, "inset:0;width:100%;height:100%")}` +
      `<div class="dots" style="position:absolute;left:0;top:0;width:4.2%;height:100%;background-color:${palette.fill}"></div>` +
      `<div class="zone" data-fit="100|48" style="position:absolute;left:10%;right:5%;top:6%;height:36%">${titleHtml}</div>` +
      MARK(`right:4%;bottom:3.5%;${lightMark}`),
  },
  frame: {
    name: "Keepsake frame", ref: "Guess How Much I Love You; Magic Beach",
    hero: "stage", aspectRatio: "16:9", titleInk: "dark", page: CREAM,
    build: ({ heroUrl, titleHtml, palette }) =>
      `<div class="zone centred" data-fit="76|34" style="position:absolute;left:5%;right:5%;top:4%;height:19%">${titleHtml}</div>` +
      `<div style="position:absolute;left:7%;top:25%;width:86%;height:67%;border:9px solid ${palette.fill};border-radius:18px;overflow:hidden">${heroImg(heroUrl, "inset:0;width:100%;height:100%;object-position:center 45%")}</div>` +
      MARK(`left:0;right:0;bottom:2.6%;text-align:center;color:#5A4634`),
  },
  arch: {
    name: "Arched window", ref: "Magic Beach (Alison Lester)",
    hero: "stage", aspectRatio: "16:9", titleInk: "dark", page: "#EFE3CC",
    build: ({ heroUrl, titleHtml }) =>
      `<div class="zone centred" data-fit="66|32" style="position:absolute;left:5%;right:5%;top:4.5%;height:13%">${titleHtml}</div>` +
      `<div style="position:absolute;left:12%;top:19%;width:76%;height:73%;border:8px solid #3A2415;border-radius:380px 380px 14px 14px;overflow:hidden">${heroImg(heroUrl, "inset:0;width:100%;height:100%;object-position:center 50%")}</div>` +
      MARK(`right:4%;top:4%;color:#5A4634`),
  },
  badge: {
    name: "Porthole badge", ref: "Librio 'Where's Daisy?'; Dinkleboo",
    hero: "stage-right", aspectRatio: "16:9", titleInk: "light", narrow: true,
    build: ({ heroUrl, titleHtml, palette }) =>
      `${heroImg(heroUrl, "inset:0;width:100%;height:100%;object-position:100% 60%")}` +
      `<div style="position:absolute;left:27%;top:42%;width:470px;height:470px;transform:translate(-50%,-50%);border-radius:50%;background:${CREAM}"></div>` +
      `<div style="position:absolute;left:27%;top:42%;width:446px;height:446px;transform:translate(-50%,-50%);border-radius:50%;background:${palette.fill}"></div>` +
      `<div class="zone centred" data-fit="64|28" style="position:absolute;left:27%;top:42%;width:320px;transform:translate(-50%,-50%);height:320px">${titleHtml}</div>` +
      MARK(`right:4%;top:4%;color:${ESP};background:${CREAM};padding:.7em 1.1em;border-radius:2em`),
  },
};
export const COVER_PLACEMENT_IDS = Object.keys(COVER_PLACEMENTS);

/** Deterministic placement + palette + torn-edge for a book. `exclude` lets callers drop ids. */
export function selectCoverPlacement({ seed, energy, exclude = [] }) {
  const ids = COVER_PLACEMENT_IDS.filter((id) => !exclude.includes(id));
  const h = hashSeed(seed);
  const placement = ids[h % ids.length];
  const palette = COVER_PALETTES[coverEnergyFor({ coverEnergy: energy })];
  return { placement, palette: palette[(h >>> 8) % palette.length], torn: ((h >>> 16) & 1) === 1 };
}

// ---------------------------------------------------------------------------
// Hero composition directives per hero kind (appended to the story's cover concept).
// Positive language only; the no-panel clause is universal.
// ---------------------------------------------------------------------------
export const HERO_COMPOSITIONS = {
  sky: "FRAMING: a wide 4:3 scene. The UPPER 45% of the frame is open, clear sky (or a calm, plain expanse of the setting's ceiling/wall) with nothing in it. Every figure, face and key prop sits in the LOWER HALF, full figures, feet visible, with the ground along the bottom edge.",
  portrait: "FRAMING: a TALL 3:4 portrait. The protagonist fills most of the frame from head to knees, turned slightly to the LEFT and looking at the viewer; a simple, uncluttered background (calm sky, plain wall or soft hedge) with one small hint of the story's setting at the right edge.",
  "portrait-left": "FRAMING: a TALL 3:4 portrait. The protagonist fills most of the frame from head to knees, turned slightly to the RIGHT and looking at the viewer; a simple, uncluttered background (calm sky, plain wall or soft hedge) with one small hint of the story's setting at the left edge.",
  stage: "FRAMING: a WIDE 16:9 scene. Full-length figures standing on level ground near the BOTTOM of the frame, feet just above the lower edge; the story's key setting behind them; open sky across the top.",
  "stage-right": "FRAMING: a WIDE 16:9 scene. The protagonist stands full-length in the RIGHT 40% of the frame, feet just above the lower edge, looking toward the viewer; the LEFT 60% is the story's setting only (scenery, no faces, nothing important) — a title badge will cover part of it; open sky across the top.",
};
export const NO_PANEL_CLAUSE = "The book's title will be printed over this image LATER by the layout. Do NOT paint any panel, band, box, strip, plaque, blank rectangle, lettering, words, signs or frame anywhere: the entire image is uninterrupted scene, edge to edge.";

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------
// Self-hosted STATIC TrueType fonts (assets/fonts/, OFL). Chromium embeds static TTFs as
// CIDFontType2 subsets; the Google-served VARIABLE fonts came out as Type 3 (glyph streams),
// which print prepress can reject. Variable families (Fraunces, Oswald, Nunito) were cut to
// static instances with fontTools. No network at render time.
export const COVER_FONT_FILES = {
  "Fraunces":         [["Fraunces-Bold.ttf", 700, "normal"], ["Fraunces-SemiBold.ttf", 600, "normal"], ["Fraunces-BoldItalic.ttf", 700, "italic"], ["Fraunces-SemiBoldItalic.ttf", 600, "italic"]],
  "Sorts Mill Goudy": [["SortsMillGoudy-Regular.ttf", 400, "normal"], ["SortsMillGoudy-Italic.ttf", 400, "italic"]],
  "Alegreya SC":      [["AlegreyaSC-Bold.ttf", 700, "normal"], ["AlegreyaSC-Medium.ttf", 500, "normal"]],
  "Oswald":           [["Oswald-Bold.ttf", 700, "normal"], ["Oswald-SemiBold.ttf", 600, "normal"]],
  "Patrick Hand":     [["PatrickHand-Regular.ttf", 400, "normal"]],
  "Arvo":             [["Arvo-Bold.ttf", 700, "normal"]],
  "Varela Round":     [["VarelaRound-Regular.ttf", 400, "normal"]],
  "Gochi Hand":       [["GochiHand-Regular.ttf", 400, "normal"]],
  "Nunito":           [["Nunito-ExtraBold.ttf", 800, "normal"], ["Nunito-Bold.ttf", 700, "normal"], ["Nunito-SemiBoldItalic.ttf", 600, "italic"]],
};
export const COVER_FONTS_DIR_URL = new URL("../assets/fonts/", import.meta.url).href; // file:///…/assets/fonts/

/** Family names a voice uses (its `fonts` entries are Google-style specs; the family is before ':'). */
export function voiceFontFamilies(voiceKey) {
  return [...new Set([...(COVER_VOICES[voiceKey]?.fonts ?? []).map((f) => f.split(":")[0].replace(/\+/g, " ")), "Nunito"])];
}

/** <style> with @font-face rules for the voice's families, pointing at the local TTFs. */
export function coverFontsLink(voiceKey, dirUrl = COVER_FONTS_DIR_URL) {
  const rules = [];
  for (const fam of voiceFontFamilies(voiceKey)) {
    for (const [file, weight, style] of COVER_FONT_FILES[fam] ?? []) {
      rules.push(`@font-face{font-family:'${fam}';font-weight:${weight};font-style:${style};font-display:block;src:url('${dirUrl}${file}') format('truetype');}`);
    }
  }
  return `<style>${rules.join("\n")}</style>`;
}

export const COVER_BASE_CSS = `
  @page { size: 11in 8.5in; margin: 0; }
  html,body{margin:0;padding:0;width:11in;height:8.5in;overflow:hidden;}
  .cover{position:relative;width:11in;height:8.5in;overflow:hidden;}
  .cover *{box-sizing:border-box;margin:0;}
  .hero{position:absolute;display:block;object-fit:cover;}
  .zone{overflow:visible;display:flex;flex-direction:column;justify-content:flex-start;}
  .zone.centred{justify-content:center;align-items:center;}
  .zone.centred .title{width:100%;}
  .title .ln{white-space:nowrap;}
  .mark{position:absolute;font-family:'Nunito',sans-serif;font-weight:800;font-size:10.5pt;letter-spacing:.32em;text-transform:uppercase;}
  .dots{background-image:radial-gradient(circle, rgba(246,234,216,.95) 2.5px, transparent 3px);background-size:18px 18px;}`;
// NOTE on .dots: a radial-gradient PATTERN exports as a shading. The spine placement therefore
// pre-bakes its strip? No — keep it simple and safe: the spine strip uses a solid fill plus
// SVG circles (see build below), the .dots class is unused at render and kept only for the
// $0 mockups. The renderer strips it.

/** In-page fitter: shrink each .zone's title block until it fits its zone's width and max-height. */
export const COVER_FIT_SCRIPT = `
<script>
window.__coverFitDone = false;
document.fonts.ready.then(() => {
  for (const zone of document.querySelectorAll('.zone[data-fit]')) {
    const [maxPx, minPx] = zone.dataset.fit.split('|').map(Number);
    const block = zone.querySelector('.title'); if (!block) continue;
    const maxH = zone.clientHeight || Infinity; // zones are fixed boxes (height set by the placement)
    let size = maxPx;
    block.style.fontSize = size + 'px';
    const fits = () => block.scrollWidth <= zone.clientWidth + 1 && block.scrollHeight <= maxH + 1;
    while (!fits() && size > minPx) { size -= 2; block.style.fontSize = size + 'px'; }
    zone.dataset.fitted = String(size);
  }
  window.__coverFitDone = true;
});
</script>`;

/**
 * Build the whole cover page HTML.
 * @param {object} o
 * @param {string} o.voiceKey      e.g. "wonder-5-7"
 * @param {string} o.placementId   e.g. "band"
 * @param {string} o.heroUrl       file:// URL of the (opaque JPEG) hero
 * @param {string} o.title
 * @param {string} o.name          the child's name (for the "for <name>" line)
 * @param {object} o.palette       { fill, ink }
 * @param {boolean} [o.torn]
 */
export function buildCoverPageHtml({ voiceKey, placementId, heroUrl, title, name, palette, torn = false }) {
  const voice = COVER_VOICES[voiceKey]; const pl = COVER_PLACEMENTS[placementId];
  if (!voice) throw new Error(`buildCoverPageHtml: unknown voice "${voiceKey}"`);
  if (!pl) throw new Error(`buildCoverPageHtml: unknown placement "${placementId}"`);
  const narrow = pl.narrow || false;
  // Wide strips (band / frame / arch) keep a short title on ONE line, as the real covers do.
  const oneLine = ["band", "frame", "arch"].includes(placementId) && String(title).trim().length <= 30;
  const lines = narrow ? stackLines(title, placementId === "badge" ? 11 : 9)
    : pl.narrowish ? stackLines(title, 14)
    : oneLine ? [String(title).trim()]
    : balanceTwoLines(title);
  // Ink: what reads on the background the block sits on.
  const bandFill = placementId === "band" ? (coverEnergyFor({ coverEnergy: voiceKey.split("-")[0] }) === "playful" ? palette.fill : CREAM) : null;
  const bandInk = bandFill ? (bandFill === CREAM ? "#5A4634" : palette.ink) : null;
  const ink = pl.titleInk === "light" ? "light"
    : pl.titleInk === "palette" ? (palette.ink === CREAM || palette.ink === "#FFFFFF" ? "light" : "dark")
    : pl.titleInk === "band" ? (bandFill === CREAM ? "dark" : "light")
    : "dark";
  const leftVoices = new Set(["gentle-3-5", "wonder-5-7", "playful-5-7"]);
  const align = narrow ? (placementId === "badge" ? "center" : "left") : (leftVoices.has(voiceKey) && (placementId === "sky" || placementId === "spine") ? "left" : "center");
  const titleHtml = voice.build({ lines, name, ink, align, title });
  const body = pl.build({ heroUrl, titleHtml, palette, torn, align, bandFill, bandInk });
  // Spine strip dots as solid SVG circles (no gradient pattern in the PDF).
  const bodySafe = body.replace(/<div class="dots" style="([^"]*)"><\/div>/, (_m, st) => {
    const circles = Array.from({ length: 44 }, (_, i) => `<circle cx="22" cy="${18 + i * 18}" r="2.6" fill="${CREAM}"/>`).join("");
    return `<div style="${st}"><svg viewBox="0 0 44 816" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${circles}</svg></div>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${coverFontsLink(voiceKey)}<style>${COVER_BASE_CSS}` +
    `body{background:${pl.page ?? "#FAF9F0"};}</style></head><body><div class="cover">${bodySafe}</div>${COVER_FIT_SCRIPT}</body></html>`;
}

/** Lint: the things Edge's PDF engine drops. Returns a list of offences (empty = safe). */
export function lintCoverHtml(html) {
  const out = [];
  const css = html.replace(/<script>[\s\S]*?<\/script>/g, "");
  if (/linear-gradient|conic-gradient|repeating-/.test(css)) out.push("gradient");
  if (/radial-gradient/.test(css.replace(/\.dots\{[^}]*\}/, ""))) out.push("radial-gradient in use");
  if (/mask-image|mix-blend|backdrop-filter|filter:\s*(blur|drop-shadow)|box-shadow:(?!\s*none)|text-shadow:(?!\s*none)/.test(css)) out.push("mask/blend/filter/shadow");
  if (/text-stroke/.test(css)) out.push("text-stroke (Chromium emits stroked glyphs as a Type 3 font)");
  if (/rgba\([^)]*,\s*0?\.\d+\s*\)|opacity:\s*0?\.\d/.test(css.replace(/\.dots\{[^}]*\}/, ""))) out.push("transparency");
  return out;
}
