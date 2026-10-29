/**
 * Companion picker picks → the saved secondaries (2026-10-29).
 *
 * Bug this fixes: a companion's pick never reached the book. The picker wrote it into
 * draft.secondaries (a no-op on a first visit, when there are no saved cards yet), and Continue
 * then overwrote draft.secondaries with the Zod-parsed cards, whose schema strips unknown keys.
 * Now the pick travels WITH its card in the submitted form (`chosen: { previewId, guided }`),
 * and the server attaches it here, but only after checking the preview row: it must belong to
 * THIS draft, be a finished picker option, and its image path is built server-side. A
 * client-sent path or a stranger's preview is never trusted.
 */
import { getPreviewJob } from '@/lib/preview/preview-jobs';
import type { ChosenSheet } from '@/lib/preview/types';

type Card = Record<string, unknown>;

function chosenOf(raw: unknown): { previewId: string; guided: boolean } | null {
  const c = (raw as { chosen?: unknown } | null)?.chosen as { previewId?: unknown; guided?: unknown } | null | undefined;
  if (!c || typeof c.previewId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(c.previewId)) return null;
  return { previewId: c.previewId, guided: c.guided === true };
}

export async function attachCompanionPicks(
  cards: Card[],
  rawCards: unknown,
  draftId: string,
  lookup: typeof getPreviewJob = getPreviewJob,
): Promise<Card[]> {
  const raw = Array.isArray(rawCards) ? rawCards : [];
  return Promise.all(
    cards.map(async (card, i) => {
      const c = chosenOf(raw[i]);
      // Only a card with photos has a picker; a pick without photos is stale.
      const photos = (card as { photos?: unknown }).photos;
      if (!c || !Array.isArray(photos) || photos.length === 0) return card;
      const row = await lookup(c.previewId).catch(() => null);
      const ok = row && row.draft_id === draftId && row.status === 'done' && Boolean(row.batch_id);
      if (!ok) {
        console.error(`[companion-picks] draft ${draftId}: rejected pick ${c.previewId} on card ${i + 1}`);
        return card;
      }
      const sheet: ChosenSheet = {
        subjectId: `companion-${i + 1}`,
        previewId: c.previewId,
        imagePath: `previews/${c.previewId}.png`,
        batchId: row.batch_id ?? undefined,
        // So a returning customer sees the picked picture (a signed URL; if it has expired the
        // picker falls back to "refresh your options", never a blank tile).
        imageUrl: row.image_url ?? null,
        ...(c.guided ? { guided: true } : {}),
      };
      return { ...card, chosen_sheet: sheet };
    }),
  );
}
