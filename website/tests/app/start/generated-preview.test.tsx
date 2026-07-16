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
  fireEvent.click(screen.getByRole('button', { name: /Preview them/ }));

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

  it('first busy → ONE silent retry → recovered/cached image appears (no manual re-click)', async () => {
    vi.useFakeTimers();
    req
      .mockResolvedValueOnce({ previewId: 'p1', status: 'queued', cached: false }) // attempt 1: miss
      .mockResolvedValueOnce({ previewId: 'p2', status: 'done', imageUrl: 'https://x/recovered.png', cached: true }); // silent retry: cache hit (Inngest recovered)
    stat.mockResolvedValue({ previewId: 'p1', status: 'failed' }); // attempt 1 busies
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    await vi.advanceTimersByTimeAsync(0); // requestPreview #1
    await vi.advanceTimersByTimeAsync(1500); // poll → failed → schedule silent retry
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // SILENT: no busy flash
    await vi.advanceTimersByTimeAsync(3000); // RETRY_DELAY → silent retry fires
    await vi.advanceTimersByTimeAsync(0); // requestPreview #2 → cache hit
    expect(screen.getByRole('img', { name: 'Your character' })).toHaveAttribute(
      'src',
      'https://x/recovered.png',
    );
    expect(req).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sustained outage → "busy — try again" after EXACTLY one retry (never loops)', async () => {
    vi.useFakeTimers();
    req.mockResolvedValue({ previewId: 'p', status: 'queued', cached: false });
    stat.mockResolvedValue({ previewId: 'p', status: 'failed' });
    render(<GeneratedPreview inputs={inputs} />);
    clickGenerate();
    await vi.advanceTimersByTimeAsync(0); // req #1
    await vi.advanceTimersByTimeAsync(1500); // poll fail → silent retry scheduled (no alert yet)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000); // retry fires
    await vi.advanceTimersByTimeAsync(0); // req #2
    await vi.advanceTimersByTimeAsync(1500); // poll fail → already retried → busy
    expect(screen.getByRole('alert')).toHaveTextContent(/busy|try again/i);
    expect(req).toHaveBeenCalledTimes(2); // exactly ONE retry — no loop
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
