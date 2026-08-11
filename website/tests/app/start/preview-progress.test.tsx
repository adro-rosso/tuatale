/**
 * PreviewProgress (S-D) — the time-estimate bar + staged craft copy + long-run
 * reassurance. Verifies copy advances with elapsed time and snaps to done.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PreviewProgress } from '@/app/start/child/PreviewProgress';

afterEach(() => vi.useRealTimers());

describe('PreviewProgress', () => {
  it('starts with the first craft stage', () => {
    render(<PreviewProgress done={false} />);
    expect(screen.getByText(/Mixing the paints/)).toBeInTheDocument();
  });

  it('advances copy as time passes, incl. the long-run reassurance', async () => {
    vi.useFakeTimers();
    render(<PreviewProgress done={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); }); // ~8s
    expect(screen.getByText(/Sketching their face/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(22000); }); // ~30s total
    expect(screen.getByText(/Painting their hair/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(55000); }); // ~85s total
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();
  });

  it('reflects real completion (settled / total) when provided', () => {
    // 2 of 3 landed → bar sits at ~66% immediately, not the ~0% time-creep at t=0.
    const { container } = render(<PreviewProgress done={false} completed={2} total={3} />);
    const fill = container.querySelector('.bg-iron-oxide') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeGreaterThanOrEqual(66);
  });

  it('snaps to Ready when done', () => {
    render(<PreviewProgress done={true} />);
    expect(screen.getByText(/Ready/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
