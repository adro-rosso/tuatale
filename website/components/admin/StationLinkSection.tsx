'use client';

import { useState } from 'react';
import { stationLinks } from '@/lib/admin/station-links';

/**
 * "Needs changes?" — the hand-off from the admin page (first line of review) to the local
 * review station, which is where a book is actually fixed (re-render a page, edit text,
 * re-roll a character, re-ship). The station runs on the operator's own machine from the
 * project folder, so the link targets localhost; if it isn't running, the one-line start
 * command is offered with a copy button. After a re-ship the operator comes back here and
 * clicks Ship (the station links back to this page).
 */
export function StationLinkSection({
  orderId,
  jobId,
  status,
}: {
  orderId: string;
  jobId: string;
  status: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Only a book awaiting review can be fixed: Ship deletes orders/<id>/review/ (the editable
  // pages + sheets the station loads), so a shipped book cannot be opened in the station.
  if (status !== 'awaiting_review') return null;
  const { openUrl, startCommand } = stationLinks(orderId, jobId);

  async function copy() {
    try {
      await navigator.clipboard.writeText(startCommand);
      setCopied('copied');
      setTimeout(() => setCopied('idle'), 2000);
    } catch {
      setCopied('failed');
    }
  }

  return (
    <section className="space-y-sm" aria-labelledby="station-link-heading">
      <h2
        id="station-link-heading"
        className="font-body text-warm-grey text-caption tracking-wider uppercase"
      >
        Needs changes?
      </h2>
      <div className="border-warm-grey-light bg-cream space-y-sm rounded-md border p-md">
        <p className="font-body text-near-black text-body">
          Fix pages, text or a character in the review station, re-ship, then come back here and
          click Ship.
        </p>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-iron-oxide inline-block font-medium hover:underline"
        >
          Open this book in the review station ↗
        </a>
        <div className="space-y-xs">
          <p className="font-body text-warm-grey text-caption">
            Station not running? From the project folder, run:
          </p>
          <div className="flex items-center gap-sm">
            <code className="bg-warm-grey-light/40 text-near-black rounded px-sm py-xs font-mono text-caption">
              {startCommand}
            </code>
            <button
              type="button"
              onClick={copy}
              className="text-iron-oxide font-body text-caption hover:underline"
            >
              {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed: select the text' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
