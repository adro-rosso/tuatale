/**
 * Provenance + applicability model for the admin "customer provided" panel.
 *
 * THREE STATES, NOT TWO. The panel exists so an operator can judge "did we honour the
 * input". That judgement breaks if a field which this book type NEVER ASKS FOR looks the
 * same as a field which was asked for and left blank:
 *
 *   provided — show the value.
 *   na       — not applicable to this book type. QUIET: expected, must not draw the eye.
 *              A child order has no vibe because the child flow never offers one; showing
 *              that as "not captured" would read as a failure that did not happen.
 *   empty    — applicable to this book type but absent. THIS is the one to notice.
 *
 * Deliberately, a null that the design INTENDS (reading_level NULL-until-override,
 * a blank dedication meaning "render the auto-default") is `na`-with-a-reason, not
 * `empty` — those are working as designed, and flagging them every time would turn the
 * one state that should mean "look here" into noise.
 */
import type { Tables } from '@/types/database';

type OrderRow = Tables<'orders'>;

/**
 * `vibe` exists on public.orders (verified against prod information_schema: text,
 * nullable) but is absent from the generated `database.ts` — the known generated-types
 * lag. Narrow, local cast rather than loosening OrderRow everywhere; delete it when the
 * types are regenerated (the same lag-cast pattern used for the pet columns, which were
 * dropped once types caught up in 2ab04b3).
 */
type OrderWithVibe = OrderRow & { vibe?: string | null };

export type InputField =
  | { label: string; state: 'provided'; value: string }
  | { label: string; state: 'na'; note: string }
  | { label: string; state: 'empty'; note?: string };

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Subject-level fields whose PROVENANCE DEPENDS ON BOOK TYPE.
 *
 * `child_age` is DERIVED for child/pet — ageFromRange() picks the midpoint of the band,
 * so it is our number, not theirs, and `age_range` already shows the band honestly. For
 * ADULT it is the opposite: an explicitly typed age that drives the narrated age and any
 * milestone number — the field the whole age-reconciliation decision turned on. So it is
 * surfaced as customer-provided for adult ONLY. Emitting an `na` row for child/pet would
 * add noise about a number we made up ourselves.
 */
export function buildSubjectFields(order: OrderRow): InputField[] {
  if ((order.book_type ?? 'child') !== 'adult') return [];
  const age = order.child_age;
  return [
    age === null || age === undefined
      ? { label: 'Age (typed by customer)', state: 'empty', note: 'adult orders capture an explicit age' }
      : { label: 'Age (typed by customer)', state: 'provided', value: `${age}` },
  ];
}

/** Human labels for the structured feature axes (the customer's preset picks). */
const FEATURE_LABELS: Record<string, string> = {
  hair_colour: 'hair colour',
  hair_style: 'hair',
  skin_tone: 'skin',
  eye_colour: 'eyes',
  build: 'build',
  glasses: 'glasses',
};

/**
 * APPEARANCE-provenance fields, rendered next to the free-text appearance because they
 * qualify it. Both are captured by the CHILD flow only (submit-child) — neither
 * submit-pet nor submit-adult collects them — so they are `na` for those book types.
 *
 * `child_features` matters more than its size suggests: the structured spine is
 * AUTHORITATIVE over the free text where they conflict, so an operator judging "did we
 * honour the input" against the prose alone is reading the losing half of the input.
 */
export function buildAppearanceFields(order: OrderRow): InputField[] {
  const bookType = order.book_type ?? 'child';
  const isChild = bookType === 'child';
  const fields: InputField[] = [];

  if (!isChild) {
    fields.push({
      label: 'Appearance presets',
      state: 'na',
      note: `${bookType} books use free-text appearance only`,
    });
    fields.push({ label: 'Background / heritage', state: 'na', note: `not collected for ${bookType} books` });
    return fields;
  }

  const raw = order.child_features;
  const feats =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const parts = feats
    ? Object.entries(feats)
        .filter(([, v]) => text(v))
        .map(([k, v]) => `${FEATURE_LABELS[k] ?? k}: ${String(v).replace(/_/g, ' ')}`)
    : [];

  fields.push(
    parts.length
      ? { label: 'Appearance presets', state: 'provided', value: parts.join(' · ') }
      : // The pickers default to "any" and are optional — none chosen is a normal outcome,
        // not a missing answer, so this stays quiet.
        { label: 'Appearance presets', state: 'na', note: 'left as "any" — free-text appearance only' },
  );

  const bg = text(order.background);
  fields.push(
    bg
      ? { label: 'Background / heritage', state: 'provided', value: bg }
      : { label: 'Background / heritage', state: 'na', note: 'optional — not given' },
  );

  return fields;
}

/**
 * The four fields added 2026-07-22 (art_style, vibe, reading_level, dedication_message),
 * each resolved against the order's book type.
 */
export function buildChoiceFields(order: OrderRow): InputField[] {
  const bookType = order.book_type ?? 'child';
  const isPet = bookType === 'pet';
  const isAdult = bookType === 'adult';

  const fields: InputField[] = [];

  // art_style — NOT NULL on orders, so it should always be present. Blank would be a
  // genuine anomaly, hence `empty` rather than a quiet state.
  const style = text(order.art_style);
  fields.push(
    style
      ? { label: 'Art style', state: 'provided', value: style }
      : { label: 'Art style', state: 'empty', note: 'expected on every order' },
  );

  // vibe — offered by the pet and adult flows only. The child wizard never asks.
  const vibe = text((order as OrderWithVibe).vibe);
  if (!isPet && !isAdult) {
    fields.push({ label: 'Vibe', state: 'na', note: 'child books do not set a vibe' });
  } else if (vibe) {
    fields.push({ label: 'Vibe', state: 'provided', value: vibe });
  } else {
    // A pet/adult order WITHOUT a vibe is unexpected — both flows collect one.
    fields.push({ label: 'Vibe', state: 'empty', note: `${bookType} books select a vibe` });
  }

  // reading_level — prose difficulty. Adult books ignore it (the adult register drives
  // length). Child/pet store NULL until the parent overrides the age-band default, so a
  // null here is the DESIGNED default, not a gap.
  const reading = text(order.reading_level);
  if (isAdult) {
    fields.push({ label: 'Reading level', state: 'na', note: 'the adult register drives prose length' });
  } else if (reading) {
    fields.push({ label: 'Reading level', state: 'provided', value: reading });
  } else {
    fields.push({ label: 'Reading level', state: 'na', note: 'not overridden — defaults from the age band' });
  }

  // dedication_message — optional for every book type; blank means the auto-default
  // dedication renders, which is a normal outcome rather than a missing input.
  const dedication = text(order.dedication_message);
  fields.push(
    dedication
      ? { label: 'Dedication', state: 'provided', value: dedication }
      : { label: 'Dedication', state: 'na', note: 'blank — the auto-default renders' },
  );

  return fields;
}
