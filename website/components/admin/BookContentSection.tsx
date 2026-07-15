import type { Tables, Json } from '@/types/database';

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
 */
export function BookContentSection({ order }: { order: OrderRow }) {
  const secondaries = asSecondaries(order.secondaries);
  // Pet-as-hero orders: the protagonist is a pet — no gender (null), animal_kind +
  // coat instead. Guard child_gender (nullable since the pet migration) either way.
  const isPet = order.book_type === 'pet';
  const trait = isPet
    ? order.animal_kind
    : order.child_gender
      ? order.child_gender.replace('_', ' ')
      : null;
  return (
    <section className="space-y-md">
      <h2 className="font-body text-warm-grey text-caption tracking-wider uppercase">
        Book content
      </h2>

      <div className="border-warm-grey-light bg-cream p-md space-y-sm rounded-md border">
        <Field label={isPet ? 'Pet' : 'Child'}>
          {order.child_name} · {order.age_range}
          {trait && (
            <>
              {' · '}
              <span className="capitalize">{trait}</span>
            </>
          )}
        </Field>
        <Field label={isPet ? 'Coat & markings' : 'Appearance'}>
          <span className="whitespace-pre-wrap">{order.child_appearance}</span>
        </Field>
        <Field label="Theme">
          {order.theme_template_id && (
            <span className="text-warm-grey text-caption mr-sm">[{order.theme_template_id}]</span>
          )}
          <span className="whitespace-pre-wrap">{order.theme}</span>
        </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="font-body text-body">
      <span className="text-warm-grey text-caption mr-sm tracking-wider uppercase">{label}</span>
      {children}
    </p>
  );
}
