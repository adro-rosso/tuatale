/**
 * GeneratedPreview (S-D) — the Generate → poll → image state machine, with the
 * server actions mocked. Covers: cache-instant, dispatch args, poll-to-done,
 * failure, and the hotspot affordance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/app/start/_actions/preview', () => ({
  requestPreview: vi.fn(),
  getPreviewStatus: vi.fn(),
  uploadPhoto: vi.fn(),
}));

import { GeneratedPreview } from '@/app/start/child/GeneratedPreview';
import { requestPreview, getPreviewStatus } from '@/app/start/_actions/preview';

const req = requestPreview as ReturnType<typeof vi.fn>;
const stat = getPreviewStatus as ReturnType<typeof vi.fn>;
const inputs = { age: 7, gender: 'girl', features: { hair_colour: 'brown', eye_colour: 'green' } };
const clickGenerate = () =>
  fireEvent.click(screen.getByRole('button', { name: /Generate my character/ }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('GeneratedPreview', () => {
  it('CACHE HIT: shows the image instantly, no polling', async () => {
    req.mockResolvedValue({
      previewId: 'p',
      status: 'done',
      imageUrl: 'https://x/p.png',
      cached: true,
    });
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    const img = await screen.findByRole('img', { name: 'Your character' });
    expect(img).toHaveAttribute('src', 'https://x/p.png');
    expect(stat).not.toHaveBeenCalled();
    expect(screen.getByText(/saved preview/)).toBeInTheDocument();
  });

  it('passes the current inputs to requestPreview', async () => {
    req.mockResolvedValue({ previewId: 'p', status: 'done', imageUrl: 'u', cached: false });
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    await screen.findByRole('img', { name: 'Your character' });
    expect(req.mock.calls[0]![0]).toMatchObject({
      age: 7,
      gender: 'girl',
      features: inputs.features,
    });
  });

  it('MISS → polls getPreviewStatus until done', async () => {
    vi.useFakeTimers();
    req.mockResolvedValue({ previewId: 'p', status: 'queued', cached: false });
    stat
      .mockResolvedValueOnce({ previewId: 'p', status: 'running' })
      .mockResolvedValueOnce({ previewId: 'p', status: 'done', imageUrl: 'https://x/done.png' });
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    await vi.advanceTimersByTimeAsync(0); // requestPreview resolves
    await vi.advanceTimersByTimeAsync(1500); // poll 1 → running
    await vi.advanceTimersByTimeAsync(1500); // poll 2 → done
    expect(screen.getByRole('img', { name: 'Your character' })).toHaveAttribute(
      'src',
      'https://x/done.png',
    );
  });

  it('failure surfaces a retry message (no charge)', async () => {
    req.mockResolvedValue({ previewId: 'p', status: 'queued', cached: false });
    stat.mockResolvedValue({ previewId: 'p', status: 'failed' });
    vi.useFakeTimers();
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('S-F: no cut-out part-hotspots remain', () => {
    render(<GeneratedPreview inputs={inputs} />);
    expect(screen.queryByRole('button', { name: 'Change hair' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change eyes' })).not.toBeInTheDocument();
  });

  it('photo path: forwards the chosen photo to requestPreview', async () => {
    req.mockResolvedValue({ previewId: 'p', status: 'done', imageUrl: 'u', cached: false });
    render(<GeneratedPreview inputs={inputs} photo={{ path: 'uploads/abc.png', hash: 'abc' }} />);
    clickGenerate();
    await screen.findByRole('img', { name: 'Your character' });
    expect(req.mock.calls[0]![0]).toMatchObject({ photoPath: 'uploads/abc.png', photoHash: 'abc' });
  });
});
