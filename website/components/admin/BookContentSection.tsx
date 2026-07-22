import type { Tables, Json } from '@/types/database';
import type { OrderPhoto } from '@/lib/photos/order-photos';
import {
  buildAppearanceFields,
  buildChoiceFields,
  buildSubjectFields,
  type InputField,
} from '@/lib/admin/input-fields';

type OrderRow = Tables<'orders'>;

interface Secondary {
  name?: string;
  subject_type?: 'human' | 'non_human';
  gender?: string;
  relationship?: string;
  appearance?: string;
  extra_care?: boolean;
}

function asSecondaries(json: Json): Secondary[] {
  if (!Array.isArray(json)) return [];
  return json as Secondary[];
}

/**
 * Renders the customer-facing content of the book exactly as it
 * appears on the order. Admin uses this section to verify the
 * pipeline got the right input.
 *
 * Everything here is CUSTOMER PROVIDED. The given-vs-derived comparison (what the
 * pipeline WROTE from these inputs — the Sonnet character descriptions, the resolved
 * style) is deliberately absent: story.json is not retained for a prod book today, so
 * this surface has nothing to compare against. That is stated in the UI rather than
 * silently omitted, so the panel is not mistaken for a complete picture.
 *
 * `photos` is injected rather than fetched here: signing needs async + the service role,
 * and keeping this component synchronous keeps it trivially renderable in a test.
 */
export function BookContentSection({
  order,
  photos = [],
}: {
  order: OrderRow;
  photos?: OrderPhoto[];
}) {
  const secondaries = asSecondaries(order.secondaries);
  const subjectFields = buildSubjectFields(order);
  const appearanceFields = buildAppearanceFields(order);
  const choiceFields = buildChoiceFields(order);
  // Pet-as-hero orders: the protagonist is a pet — no gender (null), animal_kind +
  // coat instead. Guard child_gender (nullable since the pet migration) either way.
  const isPet = order.book_type === 'pet';
  const isAdult = order.book_type === 'adult';
  const subjectLabel = isPet ? 'Pet' : isAdult ? 'Subject' : 'Child';
  const trait = isPet
    ? order.animal_kind
    : order.child_gender
      ? order.child_gender.replace('_', ' ')
      : null;
  return (
    <section className="space-y-md">
      <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">
        Book content · customer provided
      </h2>
      <p className="font-body text-warm-grey text-caption">
        Everything below is what the customer gave us — the brief to judge the book
        against. Pipeline-generated values available after page-level review ships.
      </p>

      {photos.length > 0 && (
        <PhotoStrip photos={photos} consentAt={order.photo_consent_at} />
      )}

      <div className="border-warm-grey-light bg-cream p-md space-y-sm rounded-md border">
        <Field label={subjectLabel}>
          {[order.child_name, order.age_range].filter(Boolean).join(' · ')}
          {trait && (
            <>
              {' · '}
              <span className="capitalize">{trait}</span>
            </>
          )}
        </Field>
        {subjectFields.map((f) => (
          <ChoiceField key={f.label} field={f} />
        ))}
        <Field label={isPet ? 'Coat & markings' : 'Appearance'}>
          <span className="whitespace-pre-wrap">{order.child_appearance}</span>
        </Field>
        {appearanceFields.map((f) => (
          <ChoiceField key={f.label} field={f} />
        ))}
        <Field label="Theme">
          {order.theme_template_id && (
            <span className="text-warm-grey text-caption mr-sm">[{order.theme_template_id}]</span>
          )}
          <span className="whitespace-pre-wrap">{order.theme}</span>
        </Field>
        {choiceFields.map((f) => (
          <ChoiceField key={f.label} field={f} />
        ))}
      </div>

      {secondaries.length > 0 && (
        <div className="space-y-sm">
          <h3 className="font-body text-warm-grey text-caption tracking-wider uppercase">
            Companions ({secondaries.length})
          </h3>
          {secondaries.map((s, idx) => (
            <div
              key={idx}
              className="border-warm-grey-light bg-cream p-md space-y-xs rounded-md border"
            >
              <p className="font-body text-near-black text-body font-medium">
                {s.name ?? '—'} {s.subject_type === 'human' ? '(person)' : '(animal / toy)'}
                {s.extra_care && (
                  <span className="text-iron-oxide text-caption ml-sm">extra care</span>
                )}
              </p>
              {s.relationship && <Field label="Relationship">{s.relationship}</Field>}
              {s.gender && <Field label="Gender">{s.gender.replace('_', ' ')}</Field>}
              {s.appearance && (
                <Field label="Appearance">
                  <span className="whitespace-pre-wrap">{s.appearance}</span>
                </Field>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Reference photos. Three visually distinct outcomes, because they mean different things:
 *   ok      → the image
 *   absent  → "photo no longer stored" — erased or reaped; the customer's photo is GONE
 *   error   → "could not load photo" — infrastructure/config; the photo may be fine
 * Collapsing the last two would let a bad deploy impersonate a deleted photo.
 */
function PhotoStrip({
  photos,
  consentAt,
}: {
  photos: OrderPhoto[];
  consentAt: string | null;
}) {
  return (
    <div className="space-y-xs">
      <h3 className="font-body text-warm-grey text-caption tracking-wider uppercase">
        Reference photos ({photos.length})
      </h3>
      {/* Consent is a COMPLIANCE fact, not part of the creative brief — but if you are
          looking at a photograph of someone's child, whether they consented belongs in
          the same eyeline. Photos present with NO consent timestamp is the one case that
          should draw the eye. */}
      <p className="font-body text-caption">
        {consentAt ? (
          <span className="text-warm-grey">
            Consent recorded{' '}
            {new Date(consentAt).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        ) : (
          <span className="text-iron-oxide font-medium">
            no consent timestamp recorded for these photos
          </span>
        )}
      </p>
      <div className="gap-sm flex flex-wrap">
        {photos.map((p) => (
          <figure key={p.key} className="w-[132px]">
            {p.state === 'ok' && p.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
              <img
                src={p.url}
                alt={p.label}
                className="border-warm-grey-light h-[132px] w-[132px] rounded-md border object-cover"
              />
            ) : (
              <div
                className={`border-warm-grey-light flex h-[132px] w-[132px] items-center justify-center rounded-md border border-dashed p-xs text-center font-body text-caption ${
                  p.state === 'absent' ? 'text-warm-grey' : 'text-iron-oxide'
                }`}
              >
                {p.state === 'absent' ? 'photo no longer stored' : 'could not load photo'}
              </div>
            )}
            <figcaption className="font-body text-warm-grey text-caption mt-xs leading-tight">
              {p.label}
              {p.state === 'error' && p.detail && (
                <span className="text-iron-oxide block break-words">{p.detail}</span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/**
 * A customer choice in one of three states. `na` is deliberately QUIET (same muted grey
 * as a label) so an expected non-answer does not read as a failure; `empty` is the only
 * one styled to draw attention.
 */
function ChoiceField({ field }: { field: InputField }) {
  if (field.state === 'provided') {
    return (
      <Field label={field.label}>
        <span className="whitespace-pre-wrap">{field.value}</span>
      </Field>
    );
  }
  if (field.state === 'na') {
    return (
      <Field label={field.label}>
        <span className="text-warm-grey text-caption italic">{field.note}</span>
      </Field>
    );
  }
  return (
    <Field label={field.label}>
      <span className="text-iron-oxide font-medium">not provided</span>
      {field.note && <span className="text-warm-grey text-caption ml-xs">({field.note})</span>}
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="font-body text-body">
      <span className="text-warm-grey text-caption mr-sm tracking-wider uppercase">{label}</span>
      {children}
    </p>
  );
}
