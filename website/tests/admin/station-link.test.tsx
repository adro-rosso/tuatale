/**
 * StationLinkSection — admin → review-station hand-off: renders only for books that exist
 * (awaiting review / shipped), links to the local station for THIS order + job, and offers
 * the one-line start command.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StationLinkSection } from '@/components/admin/StationLinkSection';
import { stationLinks } from '@/lib/admin/station-links';

const ORDER = '05ee561a-03e9-4700-a1f2-cd6649948e7b';
const JOB = 'c8ab77ef-85e5-4e74-bd3e-65665e29107c';

describe('stationLinks', () => {
  it('builds the localhost URL with order + job, and the npm start command', () => {
    const { openUrl, startCommand } = stationLinks(ORDER, JOB);
    expect(openUrl).toBe(`http://localhost:4600/?order=${ORDER}&job=${JOB}`);
    expect(startCommand).toBe(`npm run station -- ${ORDER}`);
  });
});

describe('StationLinkSection', () => {
  it('renders the link and command for a book awaiting review', () => {
    render(<StationLinkSection orderId={ORDER} jobId={JOB} status="awaiting_review" />);
    const link = screen.getByRole('link', { name: /Open this book in the review station/ });
    expect(link.getAttribute('href')).toBe(`http://localhost:4600/?order=${ORDER}&job=${JOB}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText(`npm run station -- ${ORDER}`)).toBeTruthy();
  });

  it.each(['shipped', 'pending', 'running', 'failed', 'cancelled'])('renders nothing for %s', (status) => {
    const { container } = render(<StationLinkSection orderId={ORDER} jobId={JOB} status={status} />);
    expect(container.innerHTML).toBe('');
  });

  it('copies the start command', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<StationLinkSection orderId={ORDER} jobId={JOB} status="awaiting_review" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(`npm run station -- ${ORDER}`);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
