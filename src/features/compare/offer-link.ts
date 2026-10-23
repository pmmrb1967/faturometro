import type { Offer } from '../../domain/erse';

/** The page a supplier gave the ERSE for an offer: its standard sheet, else the offer page. */
export function sheetUrl(offer: Offer): string | undefined {
  return offer.links.standardSheet ?? offer.links.offer;
}

/**
 * The same page, asking the browser to scroll to and highlight `text` (a text
 * fragment, "#:~:text="). A browser without them, or a page without the text,
 * just opens the page.
 */
export function withTextFragment(url: string, text: string): string {
  // "-", "," and "&" have a meaning inside a text fragment; encodeURIComponent leaves "-".
  const encoded = encodeURIComponent(text.trim()).replace(/-/g, '%2D');
  return `${url}${url.includes('#') ? '' : '#'}:~:text=${encoded}`;
}

/** Pages shown for more than one of these offers: generic pages, not the offer's own. */
export function sharedSheets(offers: readonly Offer[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const offer of offers) {
    const url = sheetUrl(offer);
    if (!url) continue;
    seen.set(url, (seen.get(url) ?? new Set()).add(offer.id));
  }
  return new Set([...seen].filter(([, ids]) => ids.size > 1).map(([url]) => url));
}
