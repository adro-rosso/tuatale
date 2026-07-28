-- Character-picker Slice 3 (2026-07-28) — additive, idempotent.
-- preview_jobs.face_quality: the subject's best-photo face height (YuNet faceH, 0..1) the
-- worker records during a picker mint, so the UI can auto-branch the after-2-rounds
-- escalation (weak photos → "add a clearer front-facing photo" vs hard case → operator
-- fine-tune). NULL for non-human subjects (no human face) and single previews.
-- Applied to tuatale-test via a guarded identity-checked apply; prod rides Slice-4 deploy.
alter table public.preview_jobs add column if not exists face_quality real;
