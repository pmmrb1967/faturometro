import { useState, type ReactNode } from 'react';
import type { Offer } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { sharedSheets, sheetUrl } from './offer-link';

const FIRST = 5;
const MAX = 10;

/**
 * The cheapest offers: the first five, and a button for five more (ten at most)
 * and back.
 * `render` is told whether the offer's page is shared with another offer shown.
 */
export function OfferList<T>({
  items,
  offerOf,
  render,
}: {
  items: readonly T[];
  offerOf: (item: T) => Offer;
  render: (item: T, sharedSheet: boolean) => ReactNode;
}) {
  const [count, setCount] = useState(FIRST);
  const shown = items.slice(0, count);
  const all = Math.min(items.length, MAX);
  const more = all - shown.length;
  const shared = sharedSheets(shown.map(offerOf));
  return (
    <>
      <ol className="offers">
        {shown.map((item) => render(item, shared.has(sheetUrl(offerOf(item)) ?? '')))}
      </ol>
      {all > FIRST && (
        <p className="offers-more">
          <button
            type="button"
            className="action-secondary"
            onClick={() => setCount(more > 0 ? all : FIRST)}
          >
            {more > 0 ? t.compare.showMore(more) : t.compare.showFewer(FIRST)}
          </button>
        </p>
      )}
    </>
  );
}
