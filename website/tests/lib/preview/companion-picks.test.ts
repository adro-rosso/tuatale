// Companion picker picks must survive Continue (2026-10-29): the pick travels with its card and
// the server attaches it only after verifying the preview row belongs to THIS draft.
import { describe, it, expect, vi } from 'vitest';
import { attachCompanionPicks } from '@/lib/preview/companion-picks';
import { cleanGuidance, isGuidanceAllowed } from '@/lib/preview/guidance';

const PID = '0f8a1c2e-1111-4222-8333-444455556666';
const row = (over: Record<string, unknown> = {}) => ({ id: PID, status: 'done', draft_id: 'draft-1', batch_id: 'b-1', image_url: 'u', ...over });
const card = (over: Record<string, unknown> = {}) => ({ name: 'Matthew', subject_type: 'human', relationship: 'uncle', photos: ['uploads/draft-1/a.png'], ...over });

describe('attachCompanionPicks', () => {
  it('a verified pick is attached with a SERVER-built image path (+ guided flag)', async () => {
    const lookup = vi.fn().mockResolvedValue(row());
    const out = await attachCompanionPicks([card()], [{ ...card(), chosen: { previewId: PID, guided: true } }], 'draft-1', lookup as never);
    expect(out[0]!.chosen_sheet).toEqual({ subjectId: 'companion-1', previewId: PID, imagePath: `previews/${PID}.png`, batchId: 'b-1', imageUrl: 'u', guided: true });
  });

  it('unguided pick → no guided key', async () => {
    const out = await attachCompanionPicks([card()], [{ chosen: { previewId: PID } }], 'draft-1', vi.fn().mockResolvedValue(row()) as never);
    expect(out[0]!.chosen_sheet).not.toHaveProperty('guided');
  });

  it("REJECTS another draft's preview, an unfinished one, and a non-picker row", async () => {
    for (const bad of [row({ draft_id: 'draft-2' }), row({ status: 'running' }), row({ batch_id: null }), null]) {
      const out = await attachCompanionPicks([card()], [{ chosen: { previewId: PID } }], 'draft-1', vi.fn().mockResolvedValue(bad) as never);
      expect(out[0]).not.toHaveProperty('chosen_sheet');
    }
  });

  it('ignores a malformed previewId (never looks it up) and a card without photos', async () => {
    const lookup = vi.fn().mockResolvedValue(row());
    const a = await attachCompanionPicks([card()], [{ chosen: { previewId: '../../etc' } }], 'draft-1', lookup as never);
    const b = await attachCompanionPicks([card({ photos: [] })], [{ chosen: { previewId: PID } }], 'draft-1', lookup as never);
    expect(a[0]).not.toHaveProperty('chosen_sheet');
    expect(b[0]).not.toHaveProperty('chosen_sheet');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a client-sent chosen_sheet / imagePath on the card is never what gets stored', async () => {
    const out = await attachCompanionPicks(
      [card()],
      [{ chosen: { previewId: PID }, chosen_sheet: { imagePath: 'previews/someone-else.png' } }],
      'draft-1',
      vi.fn().mockResolvedValue(row()) as never,
    );
    expect((out[0]!.chosen_sheet as { imagePath: string }).imagePath).toBe(`previews/${PID}.png`);
  });
});

describe('guidance (website side)', () => {
  it('cleans to one line', () => {
    expect(cleanGuidance('  shorter\nhair  ')).toBe('shorter hair');
    expect(cleanGuidance('   ')).toBeUndefined();
  });
  it('allows appearance changes; refuses unsafe ones', () => {
    expect(isGuidanceAllowed('shorter hair, rounder glasses')).toBe(true);
    for (const g of ['make him shirtless', 'in lingerie', 'holding a knife', 'make her 30 years old']) expect(isGuidanceAllowed(g)).toBe(false);
  });
});
