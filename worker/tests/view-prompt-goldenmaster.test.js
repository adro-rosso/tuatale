// worker/tests/view-prompt-goldenmaster.test.js — CHARACTERIZATION test for the
// buildSheetViewPrompt extraction (character-picker Slice 2, 2026-07-28).
//
// buildSheetViewPrompt was pulled out of generateBook's inline mint loop. It drives
// EVERY customer's book sheet-mint, so it MUST reproduce the pre-extraction output
// BYTE-FOR-BYTE. This test reconstructs each branch's expected prompt independently —
// the REAL (unchanged) buildSubjectSheetBasePrompt + the view suffix + the directive
// string literals FROZEN from the ORIGINAL inline source — and asserts the extracted
// function matches exactly. If the extraction altered a single byte, a case fails.
//
// Branch coverage (what actually varies): photo vs no-photo (photoRef/refAuthority),
// pet vs adult vs human-secondary vs child (label + isPet strings), matchRef pet vs
// human (chained views), and 3 art styles (medium tokens in the base prompt).
import { describe, it, expect } from "vitest";
import {
  buildSheetViewPrompt,
  buildSubjectViewZeroPrompt,
  buildSubjectSheetBasePrompt,
  CHARACTER_SHEET_PROMPTS,
} from "../../src/book-pipeline.js";
import { resolveStyle } from "../../src/art-styles.js";

// ---- Directive literals, copied VERBATIM from the ORIGINAL generateBook inline loop ----
const PHOTO_REF_HUMAN =
  `\n\nThe reference image(s) are PHOTOGRAPH(S) of the person to depict. Translate them ` +
  `into the illustration style above — same face shape, features, and hair as the ` +
  `photo, recognisably the same person; do NOT reproduce photographic detail, ` +
  `lighting, or background.`;
const PHOTO_REF_PET =
  `\n\nThe reference image(s) are PHOTOGRAPHS of the specific pet to depict. ` +
  `Translate it into the illustration style above — same species, breed, coat ` +
  `colour, and markings as the photos, recognisably the SAME individual animal ` +
  `(not a generic example of the breed); do NOT reproduce photographic detail, ` +
  `lighting, or background.`;
const refAuth = (isPet) =>
  `\n\nREFERENCE IS AUTHORITATIVE: the reference image(s) are the exact, definitive ` +
  `source for this ${isPet ? "animal's coat colour, markings, and shape" : "person's face, hair, skin tone, and build"}. ` +
  `If any word of the Appearance text above seems to conflict with a reference image, ` +
  `FOLLOW THE IMAGE. Do not substitute a generic or stereotyped ${isPet ? "example of the breed" : "person"}; ` +
  `this must be individually recognisable as the specific ${isPet ? "animal" : "person"} in the reference.`;
const MATCH_PET =
  `\n\nThis is the SAME individual animal as in the reference image — keep the ` +
  `identical face, coat colour, and markings; only the camera angle changes from ` +
  `the reference.`;
const MATCH_HUMAN =
  `\n\nThis is the SAME child as in the reference image — keep the IDENTICAL outfit ` +
  `(same shirt, shorts, and shoes, same colours), the same face and hair, and any facial ` +
  `mark on the SAME side of the face; only the camera angle changes from the reference.`;
// Expression-scope directive (2026-07-29) — RE-BASELINE. Photo-anchored views only; the
// ONLY intended change to the mint. Non-photo views (usePhoto=false) stay byte-identical.
const EXPR_HUMAN =
  `\n\nEXPRESSION — NEUTRAL BASE: give them a calm, relaxed, closed-mouth NEUTRAL expression, ` +
  `REGARDLESS of the expression in the reference photo(s). The reference defines their face, ` +
  `features, and hair, NOT their mood — do NOT copy a smile, laugh, grin, or open mouth from the photo.`;
const EXPR_PET =
  `\n\nEXPRESSION — NEUTRAL BASE: give the animal a calm, relaxed, closed-mouth NEUTRAL expression, ` +
  `REGARDLESS of the expression in the reference photo(s). The reference defines the animal's ` +
  `features, coat, and markings, NOT their mood — do NOT copy a smile, open mouth, or panting tongue from the photo.`;

const story = (style) => ({
  style: resolveStyle(style).style,
  composition_rules: "full body, centered subject, clean uncluttered background, consistent framing, face clearly visible",
  negative_prompt: "photorealistic, scary, dark, blurry, deformed hands, extra fingers, text, watermark",
});

// The expected prompt, reconstructed the way the ORIGINAL inline loop assembled it.
const expected = (subject, st, { viewIndex, subjectHasPhoto, usePhoto, hasChainRef }) => {
  const isPet = subject.subject_type === "non_human";
  const base = buildSubjectSheetBasePrompt(subject, st, subjectHasPhoto); // REAL, unchanged
  const photoRef = usePhoto ? (isPet ? PHOTO_REF_PET : PHOTO_REF_HUMAN) : "";
  const refAuthority = usePhoto ? refAuth(isPet) : ""; // REF_AUTHORITY unset in tests (prod default)
  const expressionScope = usePhoto ? (isPet ? EXPR_PET : EXPR_HUMAN) : ""; // RE-BASELINE: photo-only
  const matchRef = !usePhoto && hasChainRef ? (isPet ? MATCH_PET : MATCH_HUMAN) : "";
  return `${base}\n\nView for this image: ${CHARACTER_SHEET_PROMPTS[viewIndex]}.${photoRef}${refAuthority}${expressionScope}${matchRef}`;
};

const CASES = [
  { name: "human child protagonist, PHOTO, watercolour",
    subject: { isProtagonist: true, subject_type: "human", age: 6, name: "Kid", character_description: "a young child", markers: "freckles" },
    style: "watercolour", opts: { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false } },
  { name: "adult protagonist, PHOTO, coloured_pencil",
    subject: { isProtagonist: true, subject_type: "human", isAdult: true, age: 40, name: "Marcus", character_description: "a grown man", markers: "beard" },
    style: "coloured_pencil", opts: { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false } },
  { name: "pet protagonist (non_human), PHOTO, painterly",
    subject: { isProtagonist: true, subject_type: "non_human", animalKind: "dog", name: "Benji", character_description: "a chocolate labradoodle", markers: "tan beard" },
    style: "painterly", opts: { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false } },
  { name: "human secondary (adult), PHOTO, watercolour",
    subject: { isProtagonist: false, subject_type: "human", isAdult: true, age: 40, name: "Nicki", character_description: "a grown woman", markers: "bangs" },
    style: "watercolour", opts: { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false } },
  { name: "NO-photo human child cold view-0, watercolour (markers NOT suppressed, no directives)",
    subject: { isProtagonist: true, subject_type: "human", age: 6, name: "Kid", character_description: "a young child", markers: "freckles" },
    style: "watercolour", opts: { viewIndex: 0, subjectHasPhoto: false, usePhoto: false, hasChainRef: false } },
  { name: "view-1 CHAINED human → matchRef human",
    subject: { isProtagonist: true, subject_type: "human", age: 6, name: "Kid", character_description: "a young child", markers: "freckles" },
    style: "watercolour", opts: { viewIndex: 1, subjectHasPhoto: true, usePhoto: false, hasChainRef: true } },
  { name: "view-1 CHAINED pet → matchRef pet",
    subject: { isProtagonist: true, subject_type: "non_human", animalKind: "dog", name: "Benji", character_description: "a chocolate labradoodle", markers: "tan beard" },
    style: "painterly", opts: { viewIndex: 1, subjectHasPhoto: true, usePhoto: false, hasChainRef: true } },
];

describe("buildSheetViewPrompt — golden-master (byte-identical to the pre-extraction loop)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const st = story(c.style);
      expect(buildSheetViewPrompt(c.subject, st, c.opts)).toBe(expected(c.subject, st, c.opts));
    });
  }

  it("buildSubjectViewZeroPrompt = the photo-anchored view-0 the book locks", () => {
    const c = CASES[3]; // human secondary, photo
    const st = story(c.style);
    expect(buildSubjectViewZeroPrompt(c.subject, st)).toBe(
      buildSheetViewPrompt(c.subject, st, { viewIndex: 0, subjectHasPhoto: true, usePhoto: true, hasChainRef: false }),
    );
  });

  // PIN the view texts. The `expected()` reconstruction above imports CHARACTER_SHEET_PROMPTS,
  // so it moves in lockstep with the source — a value change can't fail the golden-master by
  // itself. This pins the exact strings so the 2026-08-05 view-0 full-body fix (was "portrait")
  // is EXPLICIT and any further drift is caught. Views 1-2 are unchanged (they chain off view-0).
  it("view texts are pinned (view-0 full-body; views 1-2 unchanged)", () => {
    expect(CHARACTER_SHEET_PROMPTS[0]).toBe(
      "front-facing full-body view, standing, feet visible, neutral expression, plain cream background",
    );
    expect(CHARACTER_SHEET_PROMPTS[1]).toBe("three-quarter view, slight smile, plain cream background");
    expect(CHARACTER_SHEET_PROMPTS[2]).toBe("side profile, neutral expression, plain cream background");
  });
});
