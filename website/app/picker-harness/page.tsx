import { notFound } from 'next/navigation';
import { CharacterPicker } from '@/app/start/child/CharacterPicker';
import { GeneratedPreview } from '@/app/start/child/GeneratedPreview';
import { sectionCard } from '@/components/ui/form-styles';
import type { PreviewBatchOption } from '@/lib/preview/types';

/**
 * DEV-ONLY render harness for the character-picker (Slice 3 render verification). Mounts the
 * REAL CharacterPicker in each forced state with fixture images, so Puppeteer can screenshot
 * every state's actual layout/CSS (green tests ≠ a render). NOT shipped — 404 in production.
 * It proves UI STATES with fixtures; the LIVE generation flow is proven at the e2e run.
 */
export const dynamic = 'force-dynamic';

const opts = (statuses: PreviewBatchOption['status'][]): PreviewBatchOption[] =>
  statuses.map((status, i) => ({
    variant: i,
    previewId: status === 'done' ? `fix-${i}` : '',
    status,
    imageUrl: status === 'done' ? `/_fixtures/picker-${i + 1}.png` : null,
    bgColor: '#fdfaee',
  }));

const base = {
  subjectKey: 'protagonist',
  name: 'Nicki',
  role: 'protagonist' as const,
  inputs: { name: 'Nicki', subject_type: 'human' as const, appearance: 'a grown woman' },
  artStyle: 'watercolour',
  photoPaths: ['uploads/harness/a.png'],
  ready: true,
};

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-warm-grey-light/60 bg-cream/40 space-y-sm rounded-2xl border p-md">
      <h2 className="font-heading text-near-black text-title" data-harness-label={label}>{label}</h2>
      <div className="mx-auto max-w-[480px]">{children}</div>
    </section>
  );
}

export default function PickerHarness() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="bg-cream space-y-lg mx-auto max-w-[768px] p-lg">
      <h1 className="font-heading text-near-black text-h2">Character-picker — state harness</h1>

      <Panel label="idle">
        <CharacterPicker {...base} __forceMode="idle" />
      </Panel>

      <Panel label="generating (tiles appear as each lands)">
        <CharacterPicker {...base} __forceMode="generating" __forceOptions={opts(['done', 'running', 'queued'])} />
      </Panel>

      <Panel label="options-ready (grid of 3, pick one)">
        <CharacterPicker {...base} __forceMode="options" __forceOptions={opts(['done', 'done', 'done'])} />
      </Panel>

      <Panel label="picked (this is your character throughout)">
        <CharacterPicker
          {...base}
          initialChosen={{ subjectId: 'protagonist', previewId: 'fix-0', imagePath: 'previews/fix-0.png', imageUrl: '/_fixtures/picker-1.png' }}
        />
      </Panel>

      <Panel label="escalation — WEAK photos (faceQuality < floor)">
        <CharacterPicker {...base} __forceMode="escalation" __forceFaceQuality={0.08} />
      </Panel>

      <Panel label="escalation — HARD case (good photos)">
        <CharacterPicker {...base} __forceMode="escalation" __forceFaceQuality={0.42} />
      </Panel>

      <Panel label="degraded / failed — 'crafted with your book' (Continue still works ↓)">
        <CharacterPicker {...base} __forceMode="degraded" />
        {/* Proof the picker never gates the form: a sibling Continue stays enabled. */}
        <button type="button" className="bg-iron-oxide text-cream rounded-full px-6 py-3 font-body" data-continue>
          Continue →
        </button>
      </Panel>

      <Panel label="SECONDARIES per-card picker (new — inside a companion card)">
        <fieldset className={`${sectionCard} space-y-md`}>
          <legend className="font-heading text-near-black text-h3 not-italic">Nicki</legend>
          <p className="font-body text-warm-grey text-caption">…name / relationship / photo fields above…</p>
          <div className="pt-sm border-warm-grey-light/50 mt-sm border-t">
            <CharacterPicker
              subjectKey="companion-1"
              name="Nicki"
              role="secondary"
              inputs={{ name: 'Nicki', subject_type: 'human' }}
              artStyle="watercolour"
              photoPaths={['uploads/harness/a.png']}
              ready
              __forceMode="options"
              __forceOptions={opts(['done', 'done', 'done'])}
            />
          </div>
        </fieldset>
      </Panel>

      <Panel label="FLAG OFF — ADULT falls back to today's single preview (byte-identical)">
        <GeneratedPreview inputs={{ age: 40, style: 'watercolour', isAdult: true, draftId: 'harness' }} photo={null} />
      </Panel>

      <Panel label="FLAG OFF — PET / SECONDARIES render NO picker (today's behavior)">
        <p className="font-body text-warm-grey text-body">
          (Nothing renders — with the flag off the pet hero form and the companion cards show exactly today’s UI, no
          picker block. Only the adult form shows its original single preview, above.)
        </p>
      </Panel>
    </main>
  );
}
