/**
 * CharacterPicker (Slice 3) — the state machine, with the server actions mocked. Covers the
 * intent gate, the NON-BLOCKING degraded fallback, the escalation branch (weak vs hard via
 * the worker faceH signal), resume-into-picked, and pick → persist. Forced-state props drive
 * the deterministic renders (the live generation flow is proven at the e2e run).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/app/start/_actions/preview', () => ({
  requestPreviewBatch: vi.fn(),
  getPreviewBatchStatus: vi.fn(),
  persistChosenSheet: vi.fn().mockResolvedValue({ ok: true }),
  getChosenSheet: vi.fn().mockResolvedValue(null),
}));

import { CharacterPicker } from '@/app/start/child/CharacterPicker';
import { persistChosenSheet } from '@/app/start/_actions/preview';

const base = {
  subjectKey: 'protagonist',
  name: 'Nicki',
  role: 'protagonist' as const,
  inputs: { name: 'Nicki', subject_type: 'human' as const },
  artStyle: 'watercolour',
  photoPaths: ['uploads/d/a.png'],
};

beforeEach(() => vi.clearAllMocks());

describe('CharacterPicker', () => {
  it('idle + not ready: the generate button is DISABLED and prompts for a photo', () => {
    render(<CharacterPicker {...base} ready={false} __forceMode="idle" />);
    expect(screen.getByRole('button', { name: /See Nicki/ })).toBeDisabled();
    expect(screen.getByText(/Add a photo/)).toBeInTheDocument();
  });

  it('idle + ready: the generate button is enabled', () => {
    render(<CharacterPicker {...base} ready __forceMode="idle" />);
    expect(screen.getByRole('button', { name: /See Nicki/ })).toBeEnabled();
  });

  it('NON-BLOCKING: degraded shows the "crafted with your book" fallback (never an error/spinner)', () => {
    render(<CharacterPicker {...base} ready __forceMode="degraded" />);
    expect(screen.getByText(/craft Nicki.s character together with your book/)).toBeInTheDocument();
    // it renders NO required field / submit that could gate the surrounding form
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('ESCALATION — weak photos (low faceH) → "add a clear, front-facing photo"', () => {
    render(<CharacterPicker {...base} ready __forceMode="escalation" __forceFaceQuality={0.08} />);
    expect(screen.getByText(/clear, front-facing photo/)).toBeInTheDocument();
  });

  it('ESCALATION — hard case (good faceH) → operator fine-tune path', () => {
    render(<CharacterPicker {...base} ready __forceMode="escalation" __forceFaceQuality={0.42} />);
    expect(screen.getByText(/fine-tunes Nicki/)).toBeInTheDocument();
  });

  it('RESUME into PICKED: a persisted pick renders "this is [name] throughout"', () => {
    render(
      <CharacterPicker
        {...base}
        ready
        initialChosen={{ subjectId: 'protagonist', previewId: 'p', imagePath: 'previews/p.png', imageUrl: '/x.png' }}
      />,
    );
    expect(screen.getByText(/This is Nicki throughout your book/)).toBeInTheDocument();
  });

  it('OPTIONS: 3 pickable tiles; choosing one persists the pick + shows the confirmation', async () => {
    const opts = [0, 1, 2].map((v) => ({ variant: v, previewId: `p${v}`, status: 'done' as const, imageUrl: `/o${v}.png`, bgColor: null }));
    render(<CharacterPicker {...base} ready __forceMode="options" __forceOptions={opts} />);
    const tiles = screen.getAllByRole('button', { name: /Choose this look for Nicki/ });
    expect(tiles).toHaveLength(3);
    fireEvent.click(tiles[1]!);
    await screen.findByText(/This is Nicki throughout/);
    expect(persistChosenSheet).toHaveBeenCalledWith('protagonist', expect.objectContaining({ previewId: 'p1', imagePath: 'previews/p1.png' }));
  });
});
