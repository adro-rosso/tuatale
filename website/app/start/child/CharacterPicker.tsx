'use client';

/**
 * Character-picker (Slice 3). Generates N book-faithful options for ONE subject, lets the
 * customer pick the most accurate, and locks it to draft.chosen_sheet. Reuses the
 * GeneratedPreview async/polling/paper-card patterns.
 *
 * NON-BLOCKING — load-bearing: this is a bonus ADORNMENT. It sets NO required field and
 * NEVER disables the form's Continue. Every terminal state (degraded / escalation) leaves
 * Continue fully usable — a book generates fine without a pick (Slice 4 falls back to a
 * normal mint). The provider being slow/down collapses to a "crafted with your book"
 * message, never a spinner-of-death.
 *
 * States: idle → generating (tiles appear as each lands) → options (pick) → picked
 * (persisted; "this is [name] throughout"); options → regenerate (≤2 re-rolls) → escalation
 * (weak photos vs hard case, via the worker faceH signal); any failure → degraded.
 */
import { useEffect, useRef, useState } from 'react';
import { requestPreviewBatch, getPreviewBatchStatus, persistChosenSheet, getChosenSheet } from '@/app/start/_actions/preview';
import type { RequestPreviewBatchInput, PreviewBatchOption, ChosenSheet } from '@/lib/preview/types';
import { PickerTile } from './PickerTile';
import { PreviewProgress } from './PreviewProgress';
import { buttonClasses } from '@/components/ui/Button';

const POLL_MS = 1500;
const TIMEOUT_MS = 150_000;
const RETRY_DELAY_MS = 3_000;
const MAX_REROLLS = 2; // initial + 2 re-rolls = 3 batches, then escalate
// Weak-photo escalation cutoff — best faceH below this ⇒ "add a clearer front-facing photo".
// n=1-derived (the 20% selection floor, Nicki); TUNABLE / revisit-with-data. LOW STAKES:
// the picker never blocks, so a wrong threshold only shows slightly-off escalation COPY.
const FACE_QUALITY_FLOOR = 0.2;

type Mode = 'idle' | 'generating' | 'options' | 'picked' | 'escalation' | 'degraded';

interface Props {
  subjectKey: string; // 'protagonist' | companion id
  name: string;
  role: 'protagonist' | 'secondary';
  inputs: RequestPreviewBatchInput['inputs'];
  artStyle?: string;
  photoPaths: string[];
  initialChosen?: ChosenSheet | null;
  /** Intent gate: only offer generation once a photo + consent are present. */
  ready: boolean;
  /** DEV/harness only: force a state for render verification (no network). */
  __forceMode?: Mode;
  __forceOptions?: PreviewBatchOption[];
  __forceFaceQuality?: number | null;
}

export function CharacterPicker(props: Props) {
  const { subjectKey, name, role, inputs, artStyle, photoPaths, initialChosen, ready } = props;
  const [mode, setMode] = useState<Mode>(props.__forceMode ?? (initialChosen ? 'picked' : 'idle'));
  const [options, setOptions] = useState<PreviewBatchOption[]>(props.__forceOptions ?? []);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenSheet | null>(initialChosen ?? null);
  const [round, setRound] = useState(0);
  const [faceQuality, setFaceQuality] = useState<number | null>(props.__forceFaceQuality ?? null);
  const [staleNote, setStaleNote] = useState(false); // a resumed pick's image expired
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedRef = useRef(false);

  const stop = () => { if (pollRef.current) clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => stop, []);

  // RESUME: on mount (no forced state, no prop pick), restore a persisted pick from the
  // draft so a returning customer lands back in PICKED — not forced to regenerate.
  useEffect(() => {
    if (props.__forceMode || initialChosen) return;
    let live = true;
    void getChosenSheet(subjectKey)
      .then((c) => { if (live && c && !c.escalated) { setChosen(c); setMode('picked'); } })
      .catch(() => { /* no session / soft — stay idle */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only resume
  }, []);

  async function start(currentRound: number) {
    stop();
    retriedRef.current = false;
    setMode('generating');
    setOptions([]);

    const onBusy = () => {
      if (!retriedRef.current) { retriedRef.current = true; pollRef.current = setTimeout(() => void start(currentRound), RETRY_DELAY_MS); return; }
      setMode('degraded');
    };

    try {
      const res = await requestPreviewBatch({ role, inputs, artStyle, photoPaths, count: 3 });
      if (res.blocked || res.options.length === 0) { onBusy(); return; }
      setBatchId(res.batchId);
      setOptions(res.options);
      const startedAt = Date.now();
      const poll = async () => {
        try {
          const s = await getPreviewBatchStatus(res.batchId);
          setOptions(s.options);
          if (s.faceQuality != null) setFaceQuality(s.faceQuality);
          const anyDone = s.options.some((o) => o.status === 'done' && o.imageUrl);
          const settled = s.options.every((o) => o.status === 'done' || o.status === 'failed');
          if (anyDone) setMode('options'); // reveal as each lands
          if (settled) { if (!anyDone) setMode('degraded'); return; }
        } catch { /* transient poll error — keep going until timeout */ }
        if (Date.now() - startedAt > TIMEOUT_MS) { if (!options.some((o) => o.status === 'done')) onBusy(); return; }
        pollRef.current = setTimeout(poll, POLL_MS);
      };
      pollRef.current = setTimeout(poll, POLL_MS);
    } catch { onBusy(); }
  }

  function begin() { setStaleNote(false); setRound(0); void start(0); }
  function tryAgain() {
    if (round >= MAX_REROLLS) { setMode('escalation'); return; }
    const next = round + 1; setRound(next); void start(next);
  }
  async function pick(o: PreviewBatchOption) {
    stop();
    const sheet: ChosenSheet = { subjectId: subjectKey, previewId: o.previewId, imagePath: `previews/${o.previewId}.png`, batchId: batchId ?? undefined, imageUrl: o.imageUrl ?? null };
    setChosen(sheet);
    setMode('picked');
    try { await persistChosenSheet(subjectKey, sheet); } catch { /* soft: pick shows locally; book still generates */ }
  }
  async function escalateToOperator() {
    const sheet: ChosenSheet = { subjectId: subjectKey, previewId: chosen?.previewId ?? '', imagePath: chosen?.imagePath ?? '', escalated: true };
    try { await persistChosenSheet(subjectKey, sheet); } catch {}
    setMode('escalation');
  }

  const weakPhotos = faceQuality != null && faceQuality < FACE_QUALITY_FLOOR;

  // ---- render ----
  return (
    <div className="space-y-md" data-testid="character-picker" data-mode={mode}>
      {mode === 'idle' ? (
        <div className="space-y-sm flex flex-col items-center text-center">
          <button type="button" onClick={begin} disabled={!ready} className={buttonClasses('primary', 'md')}>
            ✨ See {name}’s character
          </button>
          {staleNote ? (
            <p className="font-body text-warm-grey text-caption">Let’s refresh your options for {name}.</p>
          ) : (
            <p className="font-body text-warm-grey text-caption">
              {ready ? `Optional. See a few looks for ${name} and pick your favourite.` : `Add a photo above to preview ${name}.`}
            </p>
          )}
        </div>
      ) : null}

      {mode === 'generating' || mode === 'options' ? (
        <div className="space-y-sm">
          <p className="font-body text-warm-grey text-center text-caption">
            {mode === 'generating' ? `Painting a few looks for ${name}…` : `Tap the one that looks most like ${name}.`}
          </p>
          <div className="gap-sm grid grid-cols-3">
            {(options.length ? options : ([0, 1, 2].map((v) => ({ variant: v, previewId: '', status: 'queued' as const, imageUrl: null, bgColor: null })) as PreviewBatchOption[])).map((o) => (
              <PickerTile
                key={o.variant}
                status={o.status}
                imageUrl={o.imageUrl}
                bgColor={o.bgColor}
                name={name}
                selected={chosen?.previewId === o.previewId && Boolean(o.previewId)}
                onPick={o.status === 'done' && o.imageUrl ? () => void pick(o) : undefined}
              />
            ))}
          </div>
          {(() => {
            // ONE shared progress bar for the whole batch (not one per tile). Real
            // completion (settled / total) drives it; hidden once every tile has landed.
            const total = options.length || 3;
            const settled = options.filter((o) => o.status === 'done' || o.status === 'failed').length;
            const allSettled = options.length > 0 && settled === total;
            return allSettled ? null : (
              <div className="mx-auto max-w-[280px] pt-xs">
                <PreviewProgress done={false} photo completed={settled} total={total} />
              </div>
            );
          })()}
          {mode === 'options' ? (
            <div className="space-y-xs flex flex-col items-center text-center">
              <p className="font-body text-warm-grey text-caption">Like several? Pick your favourite, and we’ll use it throughout the book.</p>
              <button type="button" onClick={tryAgain} className="font-body text-iron-oxide underline text-caption">
                None of these look like {name}? Try again
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'picked' && chosen ? (
        <div className="space-y-sm flex flex-col items-center text-center">
          <div className="w-2/3 max-w-[240px]">
            <PickerTile status="done" imageUrl={chosen.imageUrl} selected name={name} onImageError={() => { setStaleNote(true); setMode('idle'); }} />
          </div>
          <p className="font-body text-near-black text-body">This is {name} throughout your book.</p>
          <button type="button" onClick={() => setMode('options')} className="font-body text-iron-oxide underline text-caption">
            Choose a different one
          </button>
        </div>
      ) : null}

      {mode === 'escalation' ? (
        <div className="border-warm-grey-light/70 bg-paper p-md space-y-sm rounded-2xl border text-center">
          {weakPhotos ? (
            <>
              <p className="font-body text-near-black text-body">For the best likeness of {name}, add a clear, front-facing photo.</p>
              <p className="font-body text-warm-grey text-caption">A well-lit face-on shot helps our art engine capture them. You can keep going either way.</p>
              <button type="button" onClick={begin} className="font-body text-iron-oxide underline text-caption">Try again with your photos</button>
            </>
          ) : (
            <>
              <p className="font-body text-near-black text-body">We’ll make sure {name} looks just right.</p>
              <p className="font-body text-warm-grey text-caption">Our team fine-tunes {name} for your book, so there’s nothing more you need to do. Continue whenever you’re ready.</p>
              <button type="button" onClick={() => void escalateToOperator()} className="font-body text-iron-oxide underline text-caption">Continue with our help</button>
            </>
          )}
        </div>
      ) : null}

      {mode === 'degraded' ? (
        <div className="border-warm-grey-light/70 bg-paper p-md space-y-sm rounded-2xl border text-center">
          <p className="font-body text-near-black text-body">We’ll craft {name}’s character together with your book.</p>
          <p className="font-body text-warm-grey text-caption">Our art engine is busy right now. No problem, and you haven’t been charged. Your book will still feature {name}.</p>
          <button type="button" onClick={begin} className="font-body text-iron-oxide underline text-caption">Try again</button>
        </div>
      ) : null}
    </div>
  );
}
