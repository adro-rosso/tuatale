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
  /** Character-picker (Slice 2): distinguishes the N options of a batch — each variant
   *  is a distinct dice roll, so they must NOT collapse to one cache slot. Absent for the
   *  single-preview path → BYTE-IDENTICAL cache key. Value = `${batchId}:${index}`. */
  variant?: string;
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
  /** Character-picker batch grouping (Slice 2). NULL for single previews. */
  batch_id?: string | null;
  variant_index?: number | null;
  /** Slice 3 escalation signal: best-photo faceH (0..1). NULL for pets/single previews. */
  face_quality?: number | null;
}

/** The customer's locked pick, persisted to draft.chosen_sheet (Slice 4 reads it). */
export interface ChosenSheet {
  subjectId: string;
  previewId?: string;
  /** Storage path of the chosen option's PNG. previews/<id>.png at pick time; Slice 4
   *  rewrites it to the durable orders/<id>/chosen/<subjectId>.png. '' when degraded. */
  imagePath: string;
  inputHash?: string;
  batchId?: string;
  imageUrl?: string | null;
  /** Set on the operator-fine-tune escalation path. */
  escalated?: boolean;
  /** Slice 4: the durable copy/PNG was unavailable → book made from photos, pick lost. */
  degraded?: boolean;
  degradedReason?: string;
}

// ---- Character-picker batch (Slice 2) --------------------------------------
/** One subject's picker request → up to MAX_BATCH_OPTIONS book-faithful options. */
export interface RequestPreviewBatchInput {
  /** Which character: the hero, or a companion. */
  role: 'protagonist' | 'secondary';
  /** Subject fields the worker builds the (book-faithful) subject from. */
  inputs: {
    id?: string;
    name?: string;
    age?: number;
    gender?: string;
    subject_type: 'human' | 'non_human';
    appearance?: string;
    features?: Record<string, string>;
    background?: string;
    animal_kind?: string;
    is_adult?: boolean;
  };
  /** Chosen art style — options mint in the book's real style. */
  artStyle?: string;
  /** Bucket paths of the subject's uploaded photos (confined to the caller's draft). */
  photoPaths: string[];
  /** Requested option count — SERVER-CAPPED at MAX_BATCH_OPTIONS, never client-trusted. */
  count?: number;
}

export interface PreviewBatchOption {
  variant: number;
  previewId: string;
  status: PreviewStatus;
  imageUrl?: string | null;
  bgColor?: string | null;
}

export interface PreviewBatchResult {
  batchId: string;
  options: PreviewBatchOption[];
  /** Best-photo faceH across the batch (Slice 3 escalation). null = pet / not yet known. */
  faceQuality?: number | null;
  /** Set when the batch was refused up-front (no spend, no rows). */
  blocked?: 'capped' | 'rate_limited' | 'no_photos';
}
