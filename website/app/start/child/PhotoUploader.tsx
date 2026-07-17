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
 * Photos here drive an ADULT owner or ANOTHER PET — never a child (the child-photo
 * privacy gate is unaffected; callers only render this for pet books).
 */
import { useRef, useState } from 'react';
import { uploadPetPhoto } from '@/app/start/_actions/preview';

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
}

export function PhotoUploader({ paths, onChange, max = 5 }: Props) {
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
        const { photoPath } = await uploadPetPhoto(fd);
        const previewUrl = URL.createObjectURL(png);
        setPreviews((prev) => ({ ...prev, [photoPath]: previewUrl }));
        next = [...next, photoPath];
        onChange(next);
      }
    } catch {
      setError('That photo didn’t upload. Please try another.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const remove = (path: string) => onChange(paths.filter((p) => p !== path));

  return (
    <div>
      <div className="gap-sm grid grid-cols-3 sm:grid-cols-5">
        {paths.map((path) => (
          <div key={path} className="border-warm-grey-light relative aspect-square overflow-hidden rounded-lg border">
            {previews[path] ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object-url thumbnail
              <img src={previews[path]} alt="Companion photo" className="h-full w-full object-cover" />
            ) : (
              <div className="bg-cream-deep font-body text-warm-grey text-caption flex h-full w-full items-center justify-center">
                Saved
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(path)}
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
            disabled={uploading}
            className="border-warm-grey-light hover:border-iron-oxide font-body text-warm-grey text-caption flex aspect-square items-center justify-center rounded-lg border-2 border-dashed transition-colors"
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
