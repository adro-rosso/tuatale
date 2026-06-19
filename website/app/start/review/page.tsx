import Link from 'next/link';
import { getDraft } from '@/lib/draft-fetch';
import { Body } from '@/components/ui/Body';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
import { submitReviewStep } from '@/app/start/_actions/submit-review';

/**
 * Step 5 — review. Read-only summary of everything entered so far,
 * grouped by step, with an "Edit" link back to each. Customer can scan
 * for typos one last time before committing.
 *
 * The Continue button advances to /start/payment.
 */
export default async function ReviewStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const dedication = (draft as { dedication_message?: string | null } | null)?.dedication_message ?? '';

  const secondaries = Array.isArray(draft?.secondaries)
    ? (draft.secondaries as Array<{
        name?: string;
        subject_type?: string;
        gender?: string;
        relationship?: string;
        appearance?: string;
        extra_care?: boolean;
      }>)
    : [];

  return (
    <div className="space-y-xl">
      <Body className="text-warm-grey text-center">
        One last look. Anything you&apos;d like to change?
      </Body>

      <ReviewSection title="About your child" editHref="/start/child">
        <Field label="Name" value={draft?.child_name} />
        <Field label="Age range" value={formatAgeRange(draft?.age_range)} />
        <Field label="Gender" value={formatGender(draft?.child_gender)} />
        <Field label="Appearance" value={draft?.child_appearance} multiline />
      </ReviewSection>

      <ReviewSection
        title={secondaries.length === 0 ? 'Companions' : `Companions (${secondaries.length})`}
        editHref="/start/secondaries"
      >
        {secondaries.length === 0 ? (
          <Body className="text-warm-grey">No companions added.</Body>
        ) : (
          <div className="space-y-md">
            {secondaries.map((s, idx) => (
              <div key={idx} className="border-warm-grey-light space-y-xs pl-md border-l-2">
                <Field label="Name" value={s.name} />
                <Field
                  label="Type"
                  value={
                    s.subject_type === 'human'
                      ? 'A person'
                      : s.subject_type === 'non_human'
                        ? 'An animal or toy'
                        : null
                  }
                />
                {s.subject_type === 'human' && (
                  <Field label="Gender" value={formatGender(s.gender)} />
                )}
                <Field label="Relationship" value={s.relationship} />
                <Field label="Appearance" value={s.appearance} multiline />
                {s.extra_care && (
                  <Body size="caption" className="text-iron-oxide">
                    Rendered with extra care (+$10)
                  </Body>
                )}
              </div>
            ))}
          </div>
        )}
      </ReviewSection>

      <ReviewSection title="Theme" editHref="/start/theme">
        <Field label="Story" value={draft?.theme} multiline />
      </ReviewSection>

      <form action={submitReviewStep} className="space-y-lg pt-lg">
        <section className="space-y-sm">
          <div className="border-warm-grey-light pb-sm border-b">
            <Heading level="3" className="not-italic">
              Dedication
            </Heading>
          </div>
          <Body size="caption" className="text-warm-grey">
            Add a dedication? e.g. &ldquo;For Maya, on your 6th birthday&rdquo;. Leave blank for the
            default.
          </Body>
          <textarea
            name="dedication_message"
            rows={2}
            maxLength={120}
            defaultValue={dedication}
            placeholder="For Maya, on your 6th birthday"
            className="font-body text-body border-warm-grey-light bg-cream p-sm focus:border-iron-oxide w-full rounded-lg border-2 focus:outline-none"
          />
        </section>

        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Looks good, continue →
          </Button>
        </div>
      </form>
    </div>
  );
}

interface ReviewSectionProps {
  title: string;
  editHref: string;
  children: React.ReactNode;
}
function ReviewSection({ title, editHref, children }: ReviewSectionProps) {
  return (
    <section className="space-y-sm">
      <div className="border-warm-grey-light pb-sm flex items-baseline justify-between border-b">
        <Heading level="3" className="not-italic">
          {title}
        </Heading>
        <Link href={editHref} className="font-body text-iron-oxide text-caption hover:underline">
          Edit
        </Link>
      </div>
      <div className="space-y-sm pt-sm">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}
function Field({ label, value, multiline = false }: FieldProps) {
  const displayed = value && value.trim().length > 0 ? value : '—';
  return (
    <div
      className={multiline ? 'space-y-xs' : 'gap-xs tablet:flex-row tablet:gap-md flex flex-col'}
    >
      <span className="font-body text-warm-grey text-caption tablet:w-32 tracking-wider uppercase">
        {label}
      </span>
      <span
        className={`font-body text-near-black text-body ${
          multiline ? 'block whitespace-pre-wrap' : ''
        } ${value ? '' : 'text-warm-grey italic'}`}
      >
        {displayed}
      </span>
    </div>
  );
}

function formatAgeRange(value: string | null | undefined): string | null {
  if (!value) return null;
  return `Ages ${value}`;
}

function formatGender(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace('_', ' ');
}
