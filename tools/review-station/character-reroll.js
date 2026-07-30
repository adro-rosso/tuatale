// tools/review-station/character-reroll.js — OPERATOR sheet-re-roll (character-picker
// operator lever, 2026-07-30). Assembly of already-shipped machinery — NOT new pipeline:
//
//   generatePickerOption (src/picker-mint.js)  — book-faithful, neutral-base view-0 option
//   THE LOCK            (src/sheet-meta.js)     — lock the picked option as the sheet
//   generate-book --only-pages                  — re-chain views 2-3 + re-render the pages
//
// The operator re-rolls a CHARACTER's likeness: generate N options, pick the best, lock it,
// and re-render exactly the pages that feature that character (from subjects_present). This
// module is PURE + fs only (no HTTP, no supabase) so it unit-tests without a server; the
// station (server.js) wires photo download + state + the shell to generate-book.
//
// OPERATOR-ONLY: the review station is a local tool, never deployed to Fly/Vercel. Nothing
// here touches the customer picker (website/) or CHARACTER_PICKER_ENABLED.
import fs from "node:fs";
import path from "node:path";
import { STYLE_VALUES, DEFAULT_STYLE, resolveStyle } from "../../src/art-styles.js";

const SHEETS = "character-sheets";
const pad2 = (n) => String(n).padStart(2, "0");

// Sheet-file shapes for a subject. Kept in ONE place so the reship whitelist
// (reship.js isShippingArtifact) and the snapshot/lock logic can't drift: a view PNG
// is `<prefix>-NN.png` (prefix = "sheet" | "companion-N"); the meta is
// `<subjectId>-meta.json` (subjectId = "protagonist" | "companion-N"). Neither ever
// matches a `-rendered.png` portrait (those live under pages/, not character-sheets/).
export const SHEET_VIEW_RE = /^(sheet|companion-\d+)-\d{2}\.png$/;
export const SHEET_META_RE = /^(protagonist|companion-\d+)-meta\.json$/;

/** The sheet FILES belonging to one subject (view PNGs for its prefix + its meta). */
export function sheetFilesForSubject(sheetsDir, prefix, subjectId) {
  if (!fs.existsSync(sheetsDir)) return [];
  return fs.readdirSync(sheetsDir).filter((f) => {
    if (f === `${subjectId}-meta.json`) return true;
    const m = SHEET_VIEW_RE.exec(f);
    return Boolean(m) && f.startsWith(`${prefix}-`);
  });
}

/** How many view PNGs the subject's sheet has on disk (the chain length to re-mint). */
export function viewCountOnDisk(sheetsDir, prefix, fallback) {
  const views = sheetFilesForSubject(sheetsDir, prefix, "\0")
    .filter((f) => SHEET_VIEW_RE.test(f) && f.startsWith(`${prefix}-`));
  return views.length || fallback;
}

const photoPathsOf = (subject) => {
  if (Array.isArray(subject?.photo_paths) && subject.photo_paths.length) return subject.photo_paths.filter(Boolean);
  if (subject?.photoPath) return [subject.photoPath];
  return [];
};

/** Pages whose subjects_present names this character. The subjects_present array holds
 *  NAMES (protagonist name + companion_characters[].name), never sheet ids. */
export function affectedPagesFor(name, story) {
  if (!name) return [];
  return (story?.scenes ?? [])
    .filter((s) => Array.isArray(s.subjects_present) && s.subjects_present.includes(name))
    .map((s) => s.page);
}

/** The art-style KEY the book was rendered in — for a faithful re-mint. Prefer the recorded
 *  key; else reverse-map the resolved style string; else the default. */
export function resolveArtStyleKey(story, meta) {
  const explicit = meta?.inputs?.art_style ?? meta?.inputs?.child?.art_style ?? story?.art_style;
  if (explicit && STYLE_VALUES.includes(explicit)) return explicit;
  if (story?.style) {
    const match = STYLE_VALUES.find((k) => resolveStyle(k).style === story.style);
    if (match) return match;
  }
  return DEFAULT_STYLE;
}

/**
 * The re-rollable subjects for a book: the protagonist + each ref-anchored companion, each
 * with its sheet prefix, view count, the pages it appears on, and its reference photos.
 * subjectId/prefix follow the pipeline convention (protagonist→"sheet"; companion→its id).
 */
export function listRerollSubjects(story, meta, sheetsDir) {
  const out = [];
  const child = meta?.inputs?.child ?? {};
  const protagName = child.name ?? (story?.character ? String(story.character).split(/[\s,]/)[0] : null) ?? "Protagonist";
  out.push({
    subjectId: "protagonist",
    name: protagName,
    prefix: "sheet",
    role: "protagonist",
    subjectType: child.subject_type ?? "human",
    viewCount: sheetsDir ? viewCountOnDisk(sheetsDir, "sheet", 3) : 3,
    affectedPages: affectedPagesFor(protagName, story),
    photoStoragePaths: photoPathsOf(child),
  });

  const secs = meta?.inputs?.secondaries ?? [];
  const comps = story?.companion_characters ?? [];
  comps.forEach((c, i) => {
    // Link the story companion (name) to its meta secondary (which carries the id) BY NAME,
    // falling back to position — the same resolution the pipeline uses (book-pipeline:1083).
    const sec = secs.find((s) => s.name === c.name) ?? secs[i] ?? {};
    const id = sec.id || `companion-${i + 1}`;
    const name = c.name ?? sec.name ?? id;
    out.push({
      subjectId: id,
      name,
      prefix: id,
      role: "secondary",
      subjectType: sec.subject_type ?? "human",
      viewCount: sheetsDir ? viewCountOnDisk(sheetsDir, id, 2) : 2,
      affectedPages: affectedPagesFor(name, story),
      photoStoragePaths: photoPathsOf(sec),
    });
  });
  return out;
}

/**
 * Build the generatePickerOption request for a subject from the customer's recorded inputs
 * (meta.json). Mirrors the wizard-input shape the customer picker feeds; artStyle is the
 * book's style key so the re-mint is faithful.
 */
export function buildMintRequest(subject, story, meta) {
  const artStyle = resolveArtStyleKey(story, meta);
  if (subject.role === "secondary") {
    const sec = (meta?.inputs?.secondaries ?? []).find((s) => (s.id || "") === subject.subjectId)
      ?? (meta?.inputs?.secondaries ?? []).find((s) => s.name === subject.name) ?? {};
    return {
      role: "secondary",
      artStyle,
      inputs: {
        id: subject.subjectId,
        name: sec.name ?? subject.name,
        age: sec.age,
        gender: sec.gender,
        subject_type: sec.subject_type ?? "human",
        is_adult: sec.is_adult === true,
        appearance: sec.appearance_markers ?? sec.appearance ?? "",
      },
    };
  }
  const c = meta?.inputs?.child ?? {};
  return {
    role: "protagonist",
    artStyle,
    inputs: {
      name: c.name ?? subject.name,
      age: c.age,
      gender: c.gender,
      subject_type: c.subject_type ?? "human",
      appearance: c.appearance ?? "",
      features: c.features,
      background: c.background,
      animal_kind: c.animal_kind,
      is_adult: c.is_adult === true,
    },
  };
}

/**
 * Generate N book-faithful options into a TRANSIENT candidates dir (never shipped, swept
 * like _raster). Clears any prior candidates first so a re-roll batch is self-contained.
 * `mint` is generatePickerOption (injectable). Returns [{ optId, file }].
 */
export async function generateOptions({ role, inputs, artStyle }, localPhotoPaths, opts = {}) {
  const { n = 3, outDir, mint, log = console } = opts;
  if (!outDir) throw new Error("generateOptions: outDir required");
  if (typeof mint !== "function") throw new Error("generateOptions: mint fn required");
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true, recursive: true });

  const options = [];
  for (let i = 1; i <= n; i++) {
    const png = await mint(
      { role, inputs: { ...inputs, photoPaths: localPhotoPaths }, artStyle },
      localPhotoPaths,
      { callKind: "picker_mint", subjectName: `reroll-${inputs.name ?? role}` },
    );
    if (!png || !png.length) throw new Error(`generateOptions: empty option ${i}/${n}`);
    const optId = `opt-${i}`;
    const file = path.join(outDir, `${optId}.png`);
    fs.writeFileSync(file, png);
    options.push({ optId, file });
    log.log?.(`  🎨 option ${i}/${n} minted (${(png.length / 1024).toFixed(0)}KB)`);
  }
  return options;
}

/** The minimal LOCKED sheet-meta resolveSheetState needs — fingerprint EXEMPT under LOCKED.
 *  Mirrors worker/src/chosen-sheet-inject.js lockedMeta; the round-trip is contract-tested
 *  via resolveSheetState (character-reroll.test.js), which is the real guarantee. */
function lockedMeta(subjectId, prefix) {
  return {
    subject_name: subjectId,
    subject_type: null,
    gender: null,
    marker_fingerprint: "locked",
    sheet_path_prefix: prefix,
    minted_at: null,
    minted_for_book: null,
    locked_shirt_colour: null,
    views: [{ view_index: 1, filename: `${prefix}-01.png` }],
    locked: true,
  };
}

/**
 * Lock the picked option as the subject's view-0 and delete stale views 2..viewCount so a
 * subsequent generate-book re-chains them off the NEW view-0 (SheetState.LOCKED). PNG FIRST,
 * then meta — so a locked meta on disk ALWAYS has its view-0 (the Slice-1 invariant).
 */
export function lockPickedOption({ sheetsDir, subjectId, prefix, viewCount, srcFile }) {
  fs.mkdirSync(sheetsDir, { recursive: true });
  const buf = fs.readFileSync(srcFile);
  fs.writeFileSync(path.join(sheetsDir, `${prefix}-01.png`), buf);
  fs.writeFileSync(path.join(sheetsDir, `${subjectId}-meta.json`), JSON.stringify(lockedMeta(subjectId, prefix)));
  const deleted = [];
  for (let v = 2; v <= (viewCount || 1); v++) {
    const f = path.join(sheetsDir, `${prefix}-${pad2(v)}.png`);
    if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); deleted.push(`${prefix}-${pad2(v)}.png`); }
  }
  return { wrote: [`${prefix}-01.png`, `${subjectId}-meta.json`], deleted };
}

/**
 * Snapshot the subject's CURRENT sheet files + the affected pages' PDFs into
 * _history/char-<subjectId>/<id>/ BEFORE a re-roll overwrites them, so a bad re-roll is
 * fully reversible (both the likeness AND the re-rendered pages). `id` is supplied by the
 * caller (server's monotonic nextId) so it stays test-deterministic.
 */
export function snapshotCharacter({ bookDir, subjectId, prefix, affectedPages = [], id }) {
  if (!id) throw new Error("snapshotCharacter: id required");
  const sheetsDir = path.join(bookDir, SHEETS);
  const pagesDir = path.join(bookDir, "pages");
  const snapDir = path.join(bookDir, "_history", `char-${subjectId}`, id);
  fs.mkdirSync(path.join(snapDir, SHEETS), { recursive: true });
  fs.mkdirSync(path.join(snapDir, "pages"), { recursive: true });

  const sheets = sheetFilesForSubject(sheetsDir, prefix, subjectId);
  for (const f of sheets) fs.copyFileSync(path.join(sheetsDir, f), path.join(snapDir, SHEETS, f));
  const pages = [];
  for (const pg of affectedPages) {
    const pdf = path.join(pagesDir, `page-${pad2(pg)}.pdf`);
    if (fs.existsSync(pdf)) { fs.copyFileSync(pdf, path.join(snapDir, "pages", `page-${pad2(pg)}.pdf`)); pages.push(pg); }
  }
  fs.writeFileSync(path.join(snapDir, "entry.json"), JSON.stringify({ id, subjectId, prefix, sheets, pages }));
  return { id, sheets, pages };
}

/** Restore a character snapshot: swap the sheet files + affected page PDFs back. Returns the
 *  affected pages so the caller re-stitches + marks them pending (re-approval). */
export function revertCharacter({ bookDir, subjectId, id }) {
  const baseDir = path.join(bookDir, "_history", `char-${subjectId}`);
  if (!id) {
    const ids = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).sort() : [];
    id = ids[ids.length - 1];
  }
  const snapDir = id ? path.join(baseDir, id) : null;
  if (!snapDir || !fs.existsSync(path.join(snapDir, "entry.json"))) {
    throw new Error(`no character snapshot to revert for ${subjectId}`);
  }
  const entry = JSON.parse(fs.readFileSync(path.join(snapDir, "entry.json"), "utf8"));
  const sheetsDir = path.join(bookDir, SHEETS);
  const pagesDir = path.join(bookDir, "pages");

  // Remove the current sheet files for this subject first (a re-chain may have added views
  // the snapshot didn't have), then restore the snapshotted set exactly.
  for (const f of sheetFilesForSubject(sheetsDir, entry.prefix, subjectId)) fs.rmSync(path.join(sheetsDir, f), { force: true });
  for (const f of fs.readdirSync(path.join(snapDir, SHEETS))) fs.copyFileSync(path.join(snapDir, SHEETS, f), path.join(sheetsDir, f));
  for (const pg of entry.pages) {
    const src = path.join(snapDir, "pages", `page-${pad2(pg)}.pdf`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(pagesDir, `page-${pad2(pg)}.pdf`));
  }
  return { restored: id, pages: entry.pages };
}
