'use client';

/**
 * "My books" switcher (multi-draft). A header dropdown listing the in-progress books this
 * browser owns (name / type / step), with Switch + Remove per row and "Start a new book" at
 * the bottom. Server actions (start/switch/delete) redirect, so each form submit navigates.
 * Rendered only when MULTI_DRAFT_ENABLED (the parent gates it).
 */
import { useEffect, useRef, useState } from 'react';
import { startNewBook, switchToDraft, deleteDraft } from '@/app/start/_actions/drafts';
import type { DraftSummary } from '@/db/drafts';

function typeLabel(bookType: string | null): string {
  return bookType === 'pet' ? 'pet book' : bookType === 'adult' ? 'adult book' : 'child book';
}
function nameLabel(name: string | null): string {
  return name?.trim() || 'Untitled book';
}
function stepLabel(step: string | null): string {
  return step ? `on the ${step} step` : 'just started';
}

export function MyBooksMenu({ drafts, currentDraftId }: { drafts: DraftSummary[]; currentDraftId: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = drafts.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="font-body text-warm-grey text-caption border-warm-grey-light hover:border-iron-oxide hover:text-near-black gap-1 px-md py-xs inline-flex items-center rounded-full border font-medium transition-colors"
      >
        My books{count > 1 ? ` (${count})` : ''}
        <span aria-hidden="true" className="text-[0.7em]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="border-warm-grey-light bg-paper p-xs absolute right-0 z-20 mt-1 w-[19rem] max-w-[85vw] rounded-xl border text-left shadow-[0_12px_34px_rgba(44,30,14,0.18)]"
        >
          <ul className="space-y-1">
            {drafts.map((d) => {
              const isCurrent = d.id === currentDraftId;
              return (
                <li
                  key={d.id}
                  className={`px-sm py-xs rounded-lg ${isCurrent ? 'bg-cream-deep' : ''}`}
                >
                  <p className="font-body text-near-black text-body font-medium">
                    {nameLabel(d.child_name)}
                    {isCurrent ? <span className="text-iron-oxide"> · current</span> : null}
                  </p>
                  <p className="font-body text-warm-grey text-caption">
                    {typeLabel(d.book_type)} · {stepLabel(d.current_step)}
                  </p>
                  <div className="gap-sm pt-xs flex items-center">
                    {!isCurrent && (
                      <form action={switchToDraft.bind(null, d.id)}>
                        <button type="submit" className="font-body text-iron-oxide text-caption font-semibold underline">
                          Switch
                        </button>
                      </form>
                    )}
                    <form
                      action={deleteDraft.bind(null, d.id)}
                      onSubmit={(e) => {
                        if (!window.confirm(`Remove ${nameLabel(d.child_name)}? This can't be undone.`)) e.preventDefault();
                      }}
                    >
                      <button type="submit" className="font-body text-warm-grey text-caption hover:text-iron-oxide font-medium">
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-warm-grey-light/70 mt-xs pt-xs border-t">
            <form action={startNewBook}>
              <button
                type="submit"
                className="font-body text-iron-oxide text-body px-sm py-xs hover:bg-cream-deep w-full rounded-lg text-left font-semibold"
              >
                ＋ Start a new book
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
