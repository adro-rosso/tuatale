// src/allocator.js
// 4-reference-image allocator for the multi-subject page-render pipeline.
//
// Stage B's hard ceiling: Gemini accepts at most 4 reference images per call
// without identity collapse. With N subjects on a page, allocate(N) returns
// how many views to use per subject so the total fits within 4 refs while
// preserving identity-anchoring on every subject.
//
// SCOPE NOTE (Step 3 production integration, 2026-05-31): this allocator
// deals EXCLUSIVELY with ref-anchored subjects (protagonist + tier-2
// secondaries). Tier-1 soft-anchored entities (text-only non-humans, e.g.
// a pet woven inline into action prose) are NEVER passed here. They don't
// appear in scene.subjects_present, don't consume reference image slots,
// and don't trigger the allocator. The 4-subject ceiling enforced here is
// therefore the ref-anchored ceiling, not the total-entity ceiling.
//
// Rules (locked, from the Step 3 design + Stage A/B probe findings):
//   N == 1            → protagonist: 3 (full sheet set; preserves the
//                       solo-page tightness verified in Stage A)
//   N == 2 humans     → 2 + 2 (front + three-quarter each; side dropped;
//                       Stage B confirmed identity holds at 2 views/subject)
//   N == 2 human+np   → 3 + 1 (protagonist keeps full 3 because non-human
//                       subjects survive on 1 front view per Stage A)
//   N == 3            → 2 + 1 + 1 (protagonist keeps 2; secondaries one each)
//   N == 4            → 1 + 1 + 1 + 1 (all subjects on front only)
//
// View priority inside each subject is implicit: the caller slices the
// subject's sheet array [0..viewsCount), and sheet ordering by minting
// convention is front (01) → three-quarter (02) → side (03). So allocating
// N views always includes the front-facing view, which is the most
// identity-laden anchor.
//
// Degraded-subject handling (Step 2 "skipped" fallback):
//   - Subject with 0 minted sheets → allocator throws. The wiring layer
//     catches the throw, removes the degraded subject from the page's
//     subjects_present, logs a warning, and re-calls the allocator with the
//     reduced subject set.
//   - Subject with fewer minted sheets than allocated (e.g. allocated 2 but
//     only 1 minted) → allocator returns min(allocated, mintedCount). Caller
//     uses what's available; identity may be weaker on that subject for
//     that page but the page renders.

const SUBJECT_TYPES = new Set(["human", "non_human"]);

/**
 * Allocate Gemini reference-image views to subjects present on a page.
 *
 * @param {string[]} subjectsPresent
 *   Names from scene.subjects_present (Step 1 schema field). The
 *   protagonist's name MUST appear; this is a story-gen invariant.
 * @param {Object<string, { id: string, isProtagonist: boolean,
 *                          subjectType: string, mintedSheetCount: number }>}
 *           subjectMetadata
 *   Map keyed by subject NAME (matching subjectsPresent strings) to that
 *   subject's id + type + how many sheets are on disk for them.
 * @returns {Object<string, number>}
 *   Map keyed by subject ID to view count (1..3). Total across all subjects
 *   is <= 8 (2026-07-01: raised from the legacy 4-ref ceiling — gemini-3.1-
 *   flash-image accepts more; each subject now gets up to 2 refs, protagonist
 *   up to 3).
 * @throws {Error} when a subject in subjectsPresent has 0 minted sheets
 *   (caller catches, drops the subject for that page, re-calls), or when
 *   subjectsPresent has > 4 names (architecturally not allowed), or when
 *   a subject's metadata is missing.
 */
export function allocate(subjectsPresent, subjectMetadata) {
  if (!Array.isArray(subjectsPresent)) {
    throw new Error("allocate: subjectsPresent must be an array of subject names");
  }
  if (subjectsPresent.length === 0) {
    throw new Error("allocate: subjectsPresent is empty (the protagonist must appear in every scene)");
  }
  if (subjectsPresent.length > 4) {
    throw new Error(`allocate: subjectsPresent has ${subjectsPresent.length} ref-anchored subjects (max 4 per design; tier-1 soft-anchored entities don't count toward this ceiling)`);
  }

  // Validate each subject has metadata + a usable mintedSheetCount.
  const subjects = [];
  for (const name of subjectsPresent) {
    const meta = subjectMetadata?.[name];
    if (!meta) {
      throw new Error(`allocate: no metadata for subject "${name}" (resolve subjects_present against story.character + story.companion_characters before calling)`);
    }
    if (typeof meta.id !== "string" || !meta.id) {
      throw new Error(`allocate: metadata for "${name}" is missing 'id'`);
    }
    if (typeof meta.subjectType !== "string" || !SUBJECT_TYPES.has(meta.subjectType)) {
      throw new Error(`allocate: metadata for "${name}" has invalid 'subjectType' (must be "human" or "non_human"; got ${JSON.stringify(meta.subjectType)})`);
    }
    if (typeof meta.mintedSheetCount !== "number" || !Number.isFinite(meta.mintedSheetCount)) {
      throw new Error(`allocate: metadata for "${name}" is missing 'mintedSheetCount'`);
    }
    if (meta.mintedSheetCount <= 0) {
      throw new Error(`allocate: subject "${name}" has no minted sheets (mintedSheetCount=${meta.mintedSheetCount}). Caller should drop this subject from subjects_present and re-call.`);
    }
    subjects.push({ name, ...meta });
  }

  const N = subjects.length;

  // Order subjects: protagonist first (anchors the page), then secondaries
  // in the order they appeared in subjectsPresent. The allocator returns a
  // map by id, but for the rule-application logic below we use a list.
  const protagonistIdx = subjects.findIndex((s) => s.isProtagonist);
  if (protagonistIdx === -1) {
    throw new Error(`allocate: no protagonist in subjects_present [${subjectsPresent.join(", ")}] (story-gen invariant violated; the protagonist must appear in every scene)`);
  }
  const ordered = [
    subjects[protagonistIdx],
    ...subjects.filter((_, i) => i !== protagonistIdx),
  ];

  // Apply per-N allocation rules.
  let allocations;
  if (N === 1) {
    allocations = [3];
  } else if (N === 2) {
    // N=2 split depends on whether the secondary is human or non_human.
    const secondary = ordered[1];
    if (secondary.subjectType === "non_human") {
      allocations = [3, 1];
    } else {
      allocations = [2, 2];
    }
  } else if (N === 3) {
    // 2026-07-01: raised from [2,1,1] (old 4-ref ceiling) to [2,2,2]. The old
    // ceiling starved each secondary to a SINGLE reference in all-three scenes —
    // exactly where multichar likeness + wardrobe drift was worst. gemini-3.1-
    // flash-image accepts >4 refs (validated in scripts/_refceiling-probe.mjs:
    // 6 refs accepted, likeness + outfit fidelity visibly improved). 2 is the
    // most a secondary can supply (secondaries mint 2 sheets).
    allocations = [2, 2, 2];
  } else if (N === 4) {
    // Raised from [1,1,1,1] to [2,2,2,2] on the same finding (2 refs/subject,
    // not 1). N=4 not separately probed but the mechanism matches the validated
    // N=3 case; watch the first N=4 book for latency (8 refs = larger payload).
    allocations = [2, 2, 2, 2];
  } else {
    // Unreachable — guarded above — but exhaustive for clarity.
    throw new Error(`allocate: unreachable N=${N}`);
  }

  // Cap each subject's allocation at their mintedSheetCount (Step 2
  // degraded-fewer case). Caller will see the capped count and slice
  // their sheet array accordingly.
  const result = {};
  for (let i = 0; i < ordered.length; i++) {
    const subject = ordered[i];
    const ask = allocations[i];
    const give = Math.min(ask, subject.mintedSheetCount);
    result[subject.id] = give;
  }
  return result;
}
