'use client';

/**
 * Reusable photo-upload grid — the proven pet-photo mechanism (browser
 * downscale → PNG → uploadPetPhoto → Storage path) extracted so it can drive
 * likeness for a secondary/companion too, not just the pet hero.
 *
 * Contract: the parent owns the list of Storage PATHS (string[]); this component
 * uploads new files, appends their paths, and shows a session-only preview for
 * freshly-added ones (a returning draft shows a "Saved" placeholder, since the
 * object-URL preview doesn't survive a reload — same as the pet-hero form).
 *
 * By default (pet books) photos drive an owner or another pet — no child gate. For CHILD-book
 * companions (slice ④, behind CHILD_PHOTO_ENABLED) the caller passes uploadCompanionPhoto +
 * consentVersion, which routes through the same consent + safety moderation as the protagonist.
 */
import { useRef, useState } from 'react';
import { uploadPetPhoto } from '@/app/start/_actions/preview';

// A moderation rejection is RETURNED, not thrown (a thrown Server Action message is redacted
// client-side), so the uploader can show specific copy. Pet uploads never moderate → always ok.
type UploadResult = { ok: true; photoPath: string } | { ok: false; reason: 'unsafe' | 'unavailable' };
type UploadAction = (fd: FormData) => Promise<UploadResult>;
type RemoveAction = (path: string) => Promise<{ ok: true }>;

/** Default (pet-as-hero / owner / another pet): no child gate, no moderation — always ok. */
const petUpload: UploadAction = async (fd) => {
  const { photoPath } = await uploadPetPhoto(fd);
  return { ok: true, photoPath };
};

/** Downscale any chosen image to a ≤1024px PNG in the browser before upload. */
async function toPngFile(file: File, max = 1024): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('toBlob failed');
    return new File([blob], 'photo.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Props {
  paths: string[];
  onChange: (paths: string[]) => void;
  max?: number;
  /** Upload action (default: pet upload, no child gate). Child books pass
   *  uploadCompanionPhoto (CHILD_PHOTO_ENABLED + consent + moderation). */
  upload?: UploadAction;
  /** Consent version id sent with each upload (child-book companions → 'companion-v1'). */
  consentVersion?: string;
  /** Server-side erasure on remove (default: client-only). Child/companion pass the real delete. */
  onRemovePath?: RemoveAction;
  /** Disable adding until a precondition is met (e.g. the companion consent checkbox). */
  disabled?: boolean;
}

export function PhotoUploader({
  paths,
  onChange,
  max = 5,
  upload = petUpload,
  consentVersion,
  onRemovePath,
  disabled = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      let next = [...paths];
      for (const file of Array.from(files)) {
        if (next.length >= max) break;
        const png = await toPngFile(file);
        const fd = new FormData();
        fd.append('photo', png);
        if (consentVersion) fd.append('consent_version', consentVersion);
        const res = await upload(fd);
        if (!res.ok) {
          // Moderation rejection (child-book companions) — specific, kind copy; stop here.
          setError(
            res.reason === 'unavailable'
              ? 'We couldn’t check that photo just now. Please try again.'
              : 'That photo didn’t pass our safety check. Please choose a clear, everyday photo.',
          );
          break;
        }
        const previewUrl = URL.createObjectURL(png);
        setPreviews((prev) => ({ ...prev, [res.photoPath]: previewUrl }));
        next = [...next, res.photoPath];
        onChange(next);
      }
    } catch {
      setError('That photo didn’t upload. Please try another.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Remove: when a server-side erasure is provided (child/companion), DELETE the object
  // first, then drop it locally; otherwise client-only (pet default, unchanged).
  async function remove(path: string) {
    setError(null);
    if (onRemovePath) {
      try {
        await onRemovePath(path);
      } catch {
        setError('Couldn’t remove that photo. Please try again.');
        return;
      }
    }
    onChange(paths.filter((p) => p !== path));
  }

  return (
    <div>
      <div className="gap-sm grid grid-cols-3 sm:grid-cols-5">
        {paths.map((path) => (
          <div key={path} className="border-warm-grey-light bg-cream-deep relative aspect-square overflow-hidden rounded-lg border">
            {previews[path] ? (
              // object-contain (not cover) so the customer sees the WHOLE uploaded photo, uncropped.
              // eslint-disable-next-line @next/next/no-img-element -- local object-url thumbnail
              <img src={previews[path]} alt="Companion photo" className="h-full w-full object-contain" />
            ) : (
              <div className="bg-cream-deep font-body text-warm-grey text-caption flex h-full w-full items-center justify-center">
                Saved
              </div>
            )}
            <button
              type="button"
              onClick={() => void remove(path)}
              className="bg-near-black/70 absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-cream"
              aria-label="Remove photo"
            >
              ×
            </button>
          </div>
        ))}
        {paths.length < max && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || disabled}
            className="border-warm-grey-light hover:border-iron-oxide font-body text-warm-grey text-caption flex aspect-square items-center justify-center rounded-lg border-2 border-dashed transition-colors disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Add'}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      {error && (
        <p className="font-body text-iron-oxide text-caption pt-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
