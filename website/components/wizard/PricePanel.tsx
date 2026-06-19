import { calculatePrice, formatPrice } from '@/lib/pricing';
import { Body } from '@/components/ui/Body';
import { Heading } from '@/components/ui/Heading';

interface PricePanelProps {
  // Just the slice of the draft the calculator needs. Keeps the prop
  // contract minimal so we don't accidentally couple the panel to other
  // draft fields. Phase 2.C only cares about secondaries + extra_care.
  secondaries: ReadonlyArray<{ extra_care?: boolean }>;
}

/**
 * Live price panel rendered alongside the wizard form. Server
 * component — re-renders on each route navigation, which is exactly
 * when the price would actually change (after a step submission).
 *
 * Layout: on desktop the parent positions this as a 280px sticky
 * sidebar. On mobile the parent places it below the form content.
 * The panel itself is layout-agnostic — it renders as a card and lets
 * the wrapper decide where the card goes.
 */
export function PricePanel({ secondaries }: PricePanelProps) {
  const price = calculatePrice({ secondaries });

  return (
    <aside
      aria-label="Your book, price summary"
      className="bg-cream-deep border-warm-grey-light p-lg rounded-lg border"
    >
      <Heading level="3" className="mb-md not-italic">
        Your book
      </Heading>

      <ul className="space-y-sm mb-md">
        {price.line_items.map((item) => (
          <li key={item.label} className="text-body flex items-center justify-between">
            <span className="text-near-black">{item.label}</span>
            <span className="text-near-black tabular-nums">{formatPrice(item.cents)}</span>
          </li>
        ))}
      </ul>

      <div className="border-warm-grey-light pt-md flex items-center justify-between border-t">
        <span className="font-body text-near-black text-body font-medium">Total</span>
        <span className="font-heading text-iron-oxide text-h3 tabular-nums">
          {formatPrice(price.total)}
        </span>
      </div>

      <Body size="caption" className="mt-md">
        We charge once. You&apos;ll see your book before printing.
      </Body>
    </aside>
  );
}
