// src/character-features.js
// Structured character-feature contract (Spec: structured inputs, 2026-06-11).
// SINGLE SOURCE OF TRUTH for: the allowed preset values per axis, the gender-gated
// hair constraint, the pure compose/inject functions, and the adapter-boundary
// validator. Consumed by:
//   - src/book-pipeline.js (re-exports compose*/inject* + wires them, gated)
//   - src/anthropic.js     (composes the story-gen seed, gap #3)
//   - worker adapter       (validateChildFeatures — the hard boundary)
//   - website Zod          (MIRRORS FEATURE_VALUES/HAIR_STYLE_BY_GENDER; a drift
//                           test asserts parity)
// hair_style values MUST equal HAIR_STYLE_PHRASE keys (a parity test guards this)
// or composeAppearance silently drops the style.

// ---- The locked value sets (verbatim contract) ----
export const FEATURE_VALUES = {
  hair_colour: ["black", "dark-brown", "brown", "light-brown", "dark-blonde", "blonde", "auburn", "red"],
  hair_style: ["buzzed", "short", "short-curly", "tousled", "coily-afro", "shoulder-length", "long", "ponytail", "pigtails", "braids", "bun", "bald"],
  skin_tone: ["porcelain", "fair", "light", "medium-olive", "tan", "brown", "deep-brown"],
  eye_colour: ["dark-brown", "brown", "hazel", "green", "blue", "grey"],
  glasses: ["yes", "no"],
  build: ["slight", "average", "sturdy"],
};
export const OUTFIT_VALUES = {
  tee: ["red", "blue", "green", "yellow", "orange", "purple", "white", "grey"],
  shorts: ["denim-blue", "navy", "khaki", "grey", "black", "forest"],
  shoes: ["white-sneakers", "red-sneakers", "blue-sneakers", "black", "brown-boots"],
};
export const MARK_VALUES = {
  type: ["mole", "birthmark", "scar"],
  side: ["left", "right"],
  region: ["cheek"],
};

// Gender-gated hair_style (renderability constraint: the boys-long-straight-hair
// watercolour failure). boy -> restricted set; girl / non_binary -> full set.
const BOY_HAIR_STYLE = ["buzzed", "short", "short-curly", "tousled", "coily-afro", "bald"];
export const HAIR_STYLE_BY_GENDER = {
  boy: BOY_HAIR_STYLE,
  girl: FEATURE_VALUES.hair_style,
  non_binary: FEATURE_VALUES.hair_style,
};

// The 4 identity axes that define "structured-complete" (Adro 2026-06-11).
export const STRUCTURED_COMPLETE_AXES = ["hair_colour", "hair_style", "skin_tone", "eye_colour"];
export function isStructuredComplete(features) {
  if (!features || typeof features !== "object") return false;
  return STRUCTURED_COMPLETE_AXES.every((a) => typeof features[a] === "string" && features[a].length > 0);
}

// ---- Pure compose / inject (the upstream form of the D-R injection pattern) ----
const HAIR_STYLE_PHRASE = {
  buzzed: (c) => `buzzed ${c} hair`,
  short: (c) => `short ${c} hair`,
  "short-curly": (c) => `short curly ${c} hair`,
  tousled: (c) => `tousled ${c} hair`,
  "coily-afro": (c) => `coily ${c} afro-textured hair`,
  "shoulder-length": (c) => `shoulder-length ${c} hair`,
  long: (c) => `long ${c} hair`,
  ponytail: (c) => `${c} hair in a ponytail`,
  pigtails: (c) => `${c} hair in pigtails`,
  braids: (c) => `${c} hair in braids`,
  bun: (c) => `${c} hair in a bun`,
  bald: () => "bald",
};
const kebabToWords = (v) => String(v ?? "").replace(/-/g, " ").trim();

// Descriptive identity-marker spine from structured features merged with optional
// free text + optional parent-stated background/heritage. `background` (the
// parent's own words, e.g. "Nigerian", "mixed Korean and Irish") LEADS the spine
// as a labelled clause so it reaches the illustrator verbatim; the system-prompt
// HERITAGE frame governs how it's rendered (faithfully, no caricature). Marks +
// outfit are handled on their own channels (composeMarkClause / injectOutfit).
// `background` is a backward-compatible 3rd arg — 2-arg callers are unchanged.
export function composeAppearance(features, freeText, background) {
  const f = features || {};
  const parts = [];
  if (f.hair_style || f.hair_colour) {
    const c = kebabToWords(f.hair_colour);
    const phrase = f.hair_style && HAIR_STYLE_PHRASE[f.hair_style];
    const hair = phrase ? phrase(c) : (c ? `${c} hair` : null);
    if (hair) parts.push(hair.replace(/\s+/g, " ").trim());
  }
  if (f.skin_tone) parts.push(`${kebabToWords(f.skin_tone)} skin`);
  if (f.eye_colour) parts.push(`${kebabToWords(f.eye_colour)} eyes`);
  if (f.glasses === "yes" || f.glasses === true) parts.push("glasses");
  if (f.build) parts.push(`${kebabToWords(f.build)} build`);
  const spine = parts.filter(Boolean).join("; ");
  const bg = (background ?? "").trim();
  // Background leads, verbatim from the parent, framed as a heritage clause.
  const core = [bg ? `a child of ${bg} background` : "", spine].filter(Boolean).join("; ");
  const ft = (freeText ?? "").trim();
  if (core && ft) return `${core}; also: ${ft}`;
  return core || ft;
}

// Deterministic outfit injection — protagonist only, value-driven. Mirrors
// injectShirtColour (the secondary-only id-derived path). Pure; caller gates.
export function injectOutfit(description, subject, features) {
  const outfit = features?.outfit;
  if (!outfit) return description ?? "";
  const g = subject?.gender;
  const p = g === "girl" ? "Her" : g === "non_binary" ? "Their" : "His";
  const parts = [];
  if (outfit.tee) parts.push(`${p} t-shirt is a solid ${kebabToWords(outfit.tee)}.`);
  if (outfit.shorts) parts.push(`${p} shorts are ${kebabToWords(outfit.shorts)}.`);
  if (outfit.shoes) parts.push(`${p} shoes are ${kebabToWords(outfit.shoes)}.`);
  if (!parts.length) return description ?? "";
  return `${(description ?? "").trim()} ${parts.join(" ")}`.trim();
}

// Bare mark clause for the Sonnet seed — de-emphasis bares it in the prose; the
// stamp/composite stays shelved (no localizer), so scars are carried but never
// stamped. Returns "" when no stampable/known mark.
export function composeMarkClause(marks) {
  if (!Array.isArray(marks)) return "";
  const m = marks.find((x) => x && ["mole", "birthmark", "scar"].includes(x.type) && x.side);
  if (!m) return "";
  return `a ${m.type} on the ${m.side} ${m.region || "cheek"}`;
}

// ---- Hard boundary: validate a child_features blob before it reaches the
// pipeline. Throws on ANY out-of-contract / unknown value (loud — bad data must
// not render silently). Returns the validated features, or undefined if absent.
export function validateChildFeatures(features, gender) {
  if (features == null) return undefined;
  if (typeof features !== "object" || Array.isArray(features)) {
    throw new Error(`child_features must be an object, got ${typeof features}`);
  }
  const known = new Set([...Object.keys(FEATURE_VALUES), "outfit", "marks"]);
  for (const key of Object.keys(features)) {
    if (!known.has(key)) throw new Error(`child_features: unknown axis "${key}"`);
  }
  const out = {};
  for (const axis of Object.keys(FEATURE_VALUES)) {
    const v = features[axis];
    if (v == null) continue;
    if (!FEATURE_VALUES[axis].includes(v)) {
      throw new Error(`child_features.${axis}: "${v}" is not an allowed value`);
    }
    if (axis === "hair_style") {
      const allowed = HAIR_STYLE_BY_GENDER[gender] || FEATURE_VALUES.hair_style;
      if (!allowed.includes(v)) {
        throw new Error(`child_features.hair_style: "${v}" is not allowed for gender "${gender}"`);
      }
    }
    out[axis] = v;
  }
  if (features.outfit != null) {
    if (typeof features.outfit !== "object" || Array.isArray(features.outfit)) {
      throw new Error("child_features.outfit must be an object");
    }
    const outfit = {};
    for (const item of Object.keys(features.outfit)) {
      if (!(item in OUTFIT_VALUES)) throw new Error(`child_features.outfit: unknown item "${item}"`);
      const v = features.outfit[item];
      if (v == null) continue;
      if (!OUTFIT_VALUES[item].includes(v)) throw new Error(`child_features.outfit.${item}: "${v}" is not allowed`);
      outfit[item] = v;
    }
    if (Object.keys(outfit).length) out.outfit = outfit;
  }
  if (features.marks != null) {
    if (!Array.isArray(features.marks)) throw new Error("child_features.marks must be an array");
    const marks = [];
    for (const m of features.marks) {
      if (!m || typeof m !== "object") throw new Error("child_features.marks[] entries must be objects");
      if (!MARK_VALUES.type.includes(m.type) || !MARK_VALUES.side.includes(m.side)) {
        throw new Error(`child_features.marks[] requires a valid type (${MARK_VALUES.type.join("/")}) + side (left/right)`);
      }
      if (m.region != null && !MARK_VALUES.region.includes(m.region)) {
        throw new Error(`child_features.marks[].region: "${m.region}" is not allowed`);
      }
      marks.push({ type: m.type, side: m.side, region: m.region || "cheek" });
    }
    if (marks.length) out.marks = marks;
  }
  return Object.keys(out).length ? out : undefined;
}
