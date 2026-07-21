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
  /** Optional parent-stated background/heritage. Part of the cache key. */
  background?: string;
  /** Chosen art style (W-F). Part of the cache key so switching style regenerates. */
  style?: string;
  /** content-hash of an uploaded photo (the bytes live in the bucket). */
  photoHash?: string;
  /** Adult-subject preview (book_type='adult'): labels the mint "an adult" and keeps
   *  the render audience-neutral. Part of the cache key. Absent/false for child+pet. */
  isAdult?: boolean;
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
  /** Sampled bg colour ("#rrggbb") of the generated image — the box matches it
   *  so the character melts in (no seam). null/absent → keep the default box bg. */
  bgColor?: string | null;
  /** true = served from a prior identical-input mint (no spend). */
  cached: boolean;
  /**
   * S-E cost-control: set when a NEW gen was refused (no spend, no row created).
   * 'capped' = the draft hit its free-preview ceiling; 'rate_limited' = too many
   * requests too fast / per hour. The client surfaces a friendly message and does
   * NOT poll (previewId is empty when blocked).
   */
  blocked?: 'capped' | 'rate_limited';
}

export interface PreviewJobRow {
  id: string;
  status: PreviewStatus;
  image_url: string | null;
  bg_color: string | null;
  error_message: string | null;
  input_hash: string;
  draft_id: string | null;
}
