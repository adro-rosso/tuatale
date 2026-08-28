/**
 * PhotoHero uploaded-state confirmation (child photo step). When a photo is uploaded it
 * must show a clear "uploaded" confirmation — a thumbnail + a success indicator — not just
 * the file name (Adro's preview review).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhotoHero } from '@/app/start/child/PhotoHero';

const noop = vi.fn();
const base = { uploading: false, error: null, onChoose: noop, onRemove: noop };
const photo = { path: 'uploads/d/x.png', hash: 'h', name: 'my-kid.png' };

describe('PhotoHero — uploaded confirmation', () => {
  it('no photo → prompt to choose, no confirmation', () => {
    const html = renderToStaticMarkup(<PhotoHero {...base} photo={null} previewUrl={null} />);
    expect(html).toMatch(/Use a photo of your child/i);
    expect(html).not.toMatch(/Photo added/i);
  });

  it('uploaded photo → success indicator + thumbnail (previewUrl) + filename', () => {
    const html = renderToStaticMarkup(
      <PhotoHero {...base} photo={photo} previewUrl="blob:preview-123" />,
    );
    expect(html).toMatch(/Photo added/i); // clear success indicator
    expect(html).toContain('blob:preview-123'); // thumbnail img src
    expect(html).toContain('my-kid.png'); // filename retained
    expect(html).toMatch(/remove/i); // still removable
  });

  it('uploaded photo without a previewUrl → still confirms, with a 📷 fallback (no broken img)', () => {
    const html = renderToStaticMarkup(<PhotoHero {...base} photo={photo} previewUrl={null} />);
    expect(html).toMatch(/Photo added/i);
    expect(html).not.toContain('<img'); // no broken/empty thumbnail
  });
});
