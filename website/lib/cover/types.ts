/**
 * Cover-preview types (Batch 4a). Kept OUT of the 'use server' action module
 * (app/start/_actions/cover.ts), which may export only async functions — mirrors the
 * lib/preview/types.ts split.
 */
import type { PreviewStatus } from '@/lib/preview/types';

export interface CoverPreviewResult {
  /** COVER_PREVIEW_ENABLED — off → the page renders the pass-through. */
  enabled: boolean;
  title: string;
  subtitle: string | null;
  /**
   * 'done'  → imageUrl is set, render the cover.
   * 'queued'|'running' → poll getPreviewStatus(previewId) until done.
   * 'none'  → no cover source (or a soft failure) → render the pass-through. Never blocks.
   */
  status: PreviewStatus | 'none';
  imageUrl?: string | null;
  bgColor?: string | null;
  previewId?: string;
}
