/**
 * Whole-character preview types (S-C). Kept out of the 'use server' action module
 * (which may export only async functions) so the action file stays clean.
 */
export type PreviewStatus = 'queued' | 'running' | 'done' | 'failed';

/** Inputs that determine the cache key (same inputs → same image, no regen). */
export interface PreviewInputs {
  age: number;
  gender?: string;
  features?: Record<string, string>;
  freeText?: string;
  /** Chosen art style (W-F). Part of the cache key so switching style regenerates. */
  style?: string;
  /** content-hash of an uploaded photo (the bytes live in the bucket). */
  photoHash?: string;
}

/** Full request — inputs + the non-cache-key extras. */
export interface RequestPreviewInput extends PreviewInputs {
  name?: string;
  draftId?: string | null;
  /** bucket path of an already-uploaded PNG photo (photo mode). */
  photoPath?: string;
}

export interface PreviewResult {
  previewId: string;
  status: PreviewStatus;
  imageUrl?: string | null;
  /** true = served from a prior identical-input mint (no spend). */
  cached: boolean;
}

export interface PreviewJobRow {
  id: string;
  status: PreviewStatus;
  image_url: string | null;
  error_message: string | null;
  input_hash: string;
  draft_id: string | null;
}
