/**
 * CHILD_PHOTO_ENABLED — UI gate. CharacterBuilder renders the child photo path ONLY when
 * its photoEnabled prop is true (threaded from CHILD_PHOTO_ENABLED in the server page).
 * Default/false → no photo UI (the "Test only" warning + upload hero are absent), so the
 * flag being off is byte-identical to today's builder-only step.
 *
 * The preview action module is mocked so importing CharacterBuilder doesn't pull in the
 * real supabase/inngest clients. The server-side upload gate (same flag) is covered in
 * preview-action.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CharacterBuilder } from '@/app/start/child/CharacterBuilder';

vi.mock('@/app/start/_actions/preview', () => ({
  uploadPhoto: vi.fn(),
  requestPreview: vi.fn(),
  getPreviewStatus: vi.fn(),
}));

const baseProps = {
  gender: 'girl',
  values: {},
  onSet: vi.fn(),
  hairStyles: ['short'],
  age: 6,
  artStyle: 'watercolour',
  draftId: 'draft-1',
};

describe('CharacterBuilder — child photo gate (CHILD_PHOTO_ENABLED)', () => {
  it('photoEnabled=false (default): no child photo UI', () => {
    const html = renderToStaticMarkup(<CharacterBuilder {...baseProps} photoEnabled={false} />);
    expect(html).not.toMatch(/Test only/i);
    expect(html).not.toMatch(/or set their features/i); // the photo/features divider is photo-only
  });

  it('omitting photoEnabled behaves as OFF (fail-closed default)', () => {
    const html = renderToStaticMarkup(<CharacterBuilder {...baseProps} />);
    expect(html).not.toMatch(/Test only/i);
  });

  it('photoEnabled=true: the child photo path renders (private testing)', () => {
    const html = renderToStaticMarkup(<CharacterBuilder {...baseProps} photoEnabled={true} />);
    expect(html).toMatch(/Test only/i);
  });
});
