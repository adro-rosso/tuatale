// worker/src/adapter.js — order/draft → pipeline input.
//
// Maps a Supabase `orders` row (the permanent draft snapshot) onto the input
// shape the pipeline expects. Two consumers downstream care about this output:
//   1. generateStory(input)         — validates child + each secondary
//      (src/anthropic.js formatUserMessage): needs name, age, appearance_markers,
//      anchor, subject_type, and gender (humans only).
//   2. generateBook({ meta, ... })  — buildSubjectListForSheetGen joins
//      story.companion_characters to meta.inputs.secondaries by name and reads
//      `id` (→ sheet filename prefix) + `subject_type` + `anchor` + `age` +
//      `gender` + `appearance_markers`.
//
// So each adapted secondary MUST carry: id, name, age, subject_type, anchor,
// appearance_markers, relationship, and gender (humans only). Dropping `id` or
// `subject_type` (as an earlier draft of the spec did) silently breaks any
// tier-2 secondary (undefined sheet prefix + mis-tiering); tier-1-only books
// like the Elena fixture hide the bug because tier-1 entities never enter the
// companion join.
//
// Secondary rules (ratified, B.1 §4 / B.4 locked decision #5):
//   - subject_type 'human'                       -> anchor 'tier2'
//   - subject_type 'non_human' && !extra_care    -> anchor 'tier1'
//   - subject_type 'non_human' &&  extra_care    -> anchor 'tier2'
//   - age: non-human -> 5; human -> explicit age if present, else 30. The age
//     integer only satisfies the pipeline schema; the rendered likeness comes
//     from the appearance text, so the exact number is immaterial.
//
// The wizard does NOT capture a secondary `id`, so we synthesize `companion-N`
// by position (1-based) — matching the convention generate-story.js used.

import { validateChildFeatures } from "../../src/character-features.js";
import { validateArtStyle } from "../../src/art-styles.js";

const HUMAN = "human";

/**
 * Default age for a secondary. Non-humans get 5; humans use their explicit age
 * if the order somehow carries one, else 30. (The current wizard captures no
 * secondary age, so humans resolve to 30 in practice.)
 */
export function defaultAgeForSecondary(s) {
  if (s.subject_type !== HUMAN) return 5;
  if (typeof s.age === "number" && Number.isFinite(s.age) && s.age > 0) return s.age;
  return 30;
}

/** Derive the anchor tier from subject_type + extra_care. */
export function deriveAnchor(s) {
  if (s.subject_type === HUMAN) return "tier2";
  return s.extra_care ? "tier2" : "tier1";
}

// Relationships that unambiguously denote a grown-up. Used ONLY when no explicit
// age is available (the wizard captures none — see defaultAgeForSecondary).
const ADULT_RELATIONSHIP_RE =
  /\b(mum|mom|mother|dad|daddy|father|parent|step-?(mum|mom|dad|father|mother)|gran|granny|grandma|grandmother|grandad|grandpa|grandfather|nan|nana|pop|poppy|aunt|auntie|uncle|owner|carer|guardian|teacher|coach|nurse|doctor)\b/i;

/**
 * Whether a human secondary should be LABELLED an adult at sheet-mint.
 *
 * Why this matters: buildSubjectSheetBasePrompt labels a human secondary either
 * "an adult named X" (is_adult) or "a {age}-year-old child named X". Since the
 * wizard captures no secondary age, every human secondary otherwise resolves to
 * the age-30 default and mints as "a 30-year-old child named Dad" — nonsense on
 * its own, and actively likeness-destroying when a PHOTO of an adult face is
 * attached (the mint follows the words). The proven operator path set is_adult.
 *
 * Precedence: an explicit age wins; otherwise fall back to the relationship word.
 * An ambiguous relationship ("friend", "sister") stays NOT-adult, preserving
 * today's behaviour rather than inventing an adult.
 *
 * NOTE: this is a heuristic because the wizard captures no secondary age. Capturing
 * it is the real fix (see the report) — then this collapses to `age >= 18`.
 */
export function deriveIsAdult(s) {
  if (s.subject_type !== HUMAN) return false;
  if (typeof s.age === "number" && Number.isFinite(s.age) && s.age > 0) return s.age >= 18;
  return ADULT_RELATIONSHIP_RE.test(s.relationship || "");
}

/**
 * Adapt one order-secondary. `index` is the 0-based position in the array; the
 * synthesized id is `companion-${index + 1}`. Gender is forwarded ONLY for
 * humans (and NOT defaulted — see note below); for non-humans it is omitted, as
 * the pipeline requires gender be absent on non_human subjects.
 */
export function adaptSecondary(s, index) {
  const subjectType = s.subject_type;
  const adapted = {
    id: s.secondary_id || `companion-${index + 1}`,
    name: s.name,
    age: defaultAgeForSecondary(s),
    relationship: s.relationship,
    subject_type: subjectType,
    anchor: deriveAnchor(s),
    appearance_markers: s.appearance,
  };
  if (subjectType === HUMAN) {
    // Forward gender verbatim. We deliberately DO NOT default a missing gender:
    // the wizard's Zod refine already requires it on humans, so absence means
    // upstream data corruption — surfacing it (undefined → pipeline validator
    // throws) beats silently inventing a gender on a personalized book.
    adapted.gender = s.gender;
    // Label a grown-up as an adult at sheet-mint rather than "a 30-year-old child".
    // Only set when true, so a non-adult secondary's meta stays byte-identical.
    if (deriveIsAdult(s)) adapted.is_adult = true;
  }
  // Forward a photos array if present (forward-compat with the deferred
  // child-photo workstream; the pipeline ignores it today).
  if (Array.isArray(s.photos)) adapted.photos = s.photos;
  // Photo-anchor plumbing (probe, 2026-07-07): first photo = a Supabase Storage
  // path; expose it as photoPath so the worker can download it to a local file
  // and book-pipeline can photo-anchor this secondary's view-0.
  if (Array.isArray(s.photos) && s.photos[0]) adapted.photoPath = s.photos[0];
  return adapted;
}

/**
 * Adapt a full order row into the pipeline input object.
 *
 * @param {object} order  an `orders` row from Supabase
 * @returns {{ child: object, secondaries: object[], theme: string, ageRange: string }}
 */
export function adaptOrderToPipelineInput(order) {
  // book_type routes the protagonist shape: 'pet' → non-human hero; 'adult' → an adult
  // human protagonist (audience='adult' below flips story register + front-matter
  // dedication); default 'child'. Nothing sets 'adult' in prod yet (no wizard, no DB
  // enum value), so isAdult is false for every real order and child/pet output is
  // byte-identical.
  const bookType = order.book_type ?? "child";
  const isPet = bookType === "pet";
  const isAdult = bookType === "adult";
  const child = {
    name: order.child_name,
    age: order.child_age,
    // Pet: no gender (pets have none). Child: forward as-is.
    gender: isPet ? undefined : order.child_gender,
    appearance: order.child_appearance,
    // Optional parent-stated background/heritage (free text). null/absent → no
    // heritage clause. composeStorySeedAppearance weaves it in (not gated by
    // FEATURES_COMPOSE — heritage is always honoured); the HERITAGE frame governs render.
    background: order.background ?? null,
  };
  if (isPet) {
    // Non-human protagonist: species/breed + multi-photo anchor. No structured
    // features (a pet has none). photo_urls shape for pets: { pet: ["uploads/…", …] }.
    // book-pipeline's pet path (FEATURES_PET_HERO) reads subject_type + animal_kind +
    // photo_paths; the worker downloads photo_paths to local files pre-render.
    child.subject_type = "non_human";
    if (order.animal_kind) child.animal_kind = order.animal_kind;
    const petPhotos = Array.isArray(order.photo_urls?.pet)
      ? order.photo_urls.pet
      : (order.photo_urls?.pet ? [order.photo_urls.pet] : []);
    if (petPhotos.length) child.photo_paths = petPhotos;
  } else if (isAdult) {
    // Adult human protagonist. Free-text appearance (no structured child features);
    // the PHOTO drives appearance, the explicit `child_age` drives the narrated age +
    // any milestone number (age-reconciliation decision). is_adult labels the sheet
    // mint "an adult" instead of "a {age}-year-old child" — the same fix the secondary
    // path already carries (deriveIsAdult). audience='adult' (set on the return) flips
    // the story register and the front-matter dedication.
    child.is_adult = true;
    // Adult photos live under photo_urls.adult — a DELIBERATE key separation from the
    // legally-gated child key (uploadPhoto is hard-denied). `.adult` is a list (the
    // wizard may capture more than one); take the first as the view-0 anchor. Fall
    // back to `.child` only for forward/backward-compat, never as the primary path.
    const adultPhotos = Array.isArray(order.photo_urls?.adult)
      ? order.photo_urls.adult
      : (order.photo_urls?.adult ? [order.photo_urls.adult] : []);
    const adultPhoto = adultPhotos[0] ?? order.photo_urls?.child;
    if (adultPhoto) child.photoPath = adultPhoto;
  } else {
    // Hard boundary for structured features: validate against the contract (enum
    // values + gender-gated hair_style). Out-of-contract / unknown values THROW
    // here — bad data must fail loud, not reach the pipeline silently. null/absent
    // (legacy orders, free-text path) -> undefined -> features omitted (no change).
    const features = validateChildFeatures(order.child_features, order.child_gender);
    if (features) child.features = features;
    // Photo-anchor plumbing (probe, 2026-07-07): the primary's uploaded photo lives
    // in Supabase Storage; expose its path so the worker downloads it to a local file
    // before the pipeline reads it. photo_urls shape: { child?: "uploads/<hash>.png" }.
    if (order.photo_urls?.child) child.photoPath = order.photo_urls.child;
  }
  return {
    child,
    secondaries: (order.secondaries ?? []).map(adaptSecondary),
    theme: order.theme,
    // Chosen art style → generateStory reads input.style. Hard boundary:
    // null/legacy → watercolour; a present-but-unknown value THROWS (bad data
    // fails loud, like validateChildFeatures).
    style: validateArtStyle(order.art_style),
    // Optional custom dedication (front matter). null/blank → the auto-default
    // renders. Free text; the front-matter builder trims + caps + HTML-escapes it.
    dedicationMessage: order.dedication_message ?? null,
    // Age BAND (the wizard AGE_RANGES enum). generateStory reads this to default
    // the reading level losslessly (the integer child.age is a lossy midpoint).
    ageRange: order.age_range,
    // Reading level (prose difficulty). Optional — the website/DB half adds the
    // column; until then it is undefined and generateStory defaults from ageRange.
    // A present value overrides the band default.
    reading_level: order.reading_level ?? undefined,
    // Story vibe / emotional register (pet + adult books). Optional — undefined → no
    // vibe directive injected (child books). generateStory reads input.vibe; for adult
    // books the vibe (romantic/milestone/roast/adventure) also keys the front-matter
    // dedication default.
    vibe: order.vibe ?? undefined,
    // Adult-audience opt-in. undefined for child/pet → isAdultAudience(input) is false
    // → every adult branch (story register, prose cap, front-matter dedication)
    // collapses to the child/pet path. This is the ONE field that turns the inert
    // adult engine on.
    audience: isAdult ? "adult" : undefined,
  };
}
