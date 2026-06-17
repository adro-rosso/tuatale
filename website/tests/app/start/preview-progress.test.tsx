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
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText(/Painting their hair/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); }); // ~22s total
    expect(screen.getByText(/longer than usual/)).toBeInTheDocument();
  });

  it('snaps to Ready when done', () => {
    render(<PreviewProgress done={true} />);
    expect(screen.getByText(/Ready/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
