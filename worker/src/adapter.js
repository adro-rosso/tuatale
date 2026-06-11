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
  }
  // Forward a photos array if present (forward-compat with the deferred
  // child-photo workstream; the pipeline ignores it today).
  if (Array.isArray(s.photos)) adapted.photos = s.photos;
  return adapted;
}

/**
 * Adapt a full order row into the pipeline input object.
 *
 * @param {object} order  an `orders` row from Supabase
 * @returns {{ child: object, secondaries: object[], theme: string, ageRange: string }}
 */
export function adaptOrderToPipelineInput(order) {
  const child = {
    name: order.child_name,
    age: order.child_age,
    gender: order.child_gender,
    appearance: order.child_appearance,
  };
  // Hard boundary for structured features: validate against the contract (enum
  // values + gender-gated hair_style). Out-of-contract / unknown values THROW
  // here — bad data must fail loud, not reach the pipeline silently. null/absent
  // (legacy orders, free-text path) -> undefined -> features omitted (no change).
  const features = validateChildFeatures(order.child_features, order.child_gender);
  if (features) child.features = features;
  return {
    child,
    secondaries: (order.secondaries ?? []).map(adaptSecondary),
    theme: order.theme,
    // ageRange is carried for completeness; generateStory does not read it, but
    // it documents the bucket the integer age came from.
    ageRange: order.age_range,
  };
}
