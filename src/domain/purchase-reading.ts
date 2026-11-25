/**
 * What a purchase's invoice says beyond its fiscal QR code (date, total and
 * the seller's NIF): the store's name, read from the PDF's text on the device,
 * and the product, from the lines an AI reading found. Only suggestions: the
 * user confirms them on the form. Same rules as Prazómetro's invoice reading
 * (packages/ai/src/invoice.ts).
 */
import type { InvoiceLine } from './types';

/** Frequent stores in Portugal: their name, even when it is written oddly. */
const KNOWN_STORES: readonly (readonly [RegExp, string])[] = [
  [/\bworten\b/i, 'Worten'],
  [/\bfnac\b/i, 'Fnac'],
  [/media\s*markt/i, 'MediaMarkt'],
  [/r[aá]dio\s*popular/i, 'Rádio Popular'],
  [/el\s*corte\s*ingl[eé]s/i, 'El Corte Inglés'],
  [/\bikea\b/i, 'IKEA'],
  [/leroy\s*merlin/i, 'Leroy Merlin'],
  [/\bcontinente\b/i, 'Continente'],
  [/\bauchan\b/i, 'Auchan'],
  [/\bpingo\s*doce\b/i, 'Pingo Doce'],
  [/\bintermarch[eé]\b/i, 'Intermarché'],
  [/\bdecathlon\b/i, 'Decathlon'],
  [/\bamazon\b/i, 'Amazon'],
  [/\bpc\s*diga\b/i, 'PCDIGA'],
  [/\bglobal\s*data\b/i, 'Globaldata'],
  [/\bstaples\b/i, 'Staples'],
  [/\bbricomarch[eé]\b/i, 'Bricomarché'],
  [/\bconforama\b/i, 'Conforama'],
  [/\bphone\s*house\b/i, 'Phone House'],
  [/\bapple\b/i, 'Apple'],
];

/** Lines at the top of an invoice that are not the store's name. */
const NOT_STORE =
  /^(-{3}|fatura|factura|fatura-recibo|fatura simplificada|recibo|talão|original|duplicado|triplicado|cópia|segunda via|página|pag\.|documento|nif|contribuinte|data|cliente|exmo|exma)/i;

/** The store's name in an invoice's text (lines top to bottom), or "" when not found. */
export function storeFromText(text: string): string {
  for (const [pattern, name] of KNOWN_STORES) if (pattern.test(text)) return name;
  for (const raw of text.split('\n').slice(0, 8)) {
    // A row of a PDF has its cells joined with " | ": the first one is the name.
    const line = (raw.split(' | ')[0] ?? '').trim();
    const letters = line.replace(/[^\p{L}]/gu, '');
    if (letters.length < 3 || NOT_STORE.test(line) || /\d{4}-\d{3}/.test(line)) continue;
    return line.replace(/,?\s*(S\.?\s?A\.?|Lda\.?|Unipessoal)\.?$/i, '').slice(0, 80);
  }
  return '';
}

/** Lines that are not the thing bought: taxes, discounts, delivery, extended warranties. */
const NOT_PRODUCT =
  /entrega|portes|transporte|envio|extens[aã]o de garantia|seguro|ecovalor|ecotaxa/i;

/** The product bought: the line of highest amount that is a good, or "" when none. */
export function productFromLines(
  lines: readonly Pick<InvoiceLine, 'kind' | 'description' | 'amountCents'>[],
): string {
  const goods = lines.filter(
    (line) =>
      line.kind !== 'tax' &&
      line.kind !== 'discount' &&
      line.amountCents > 0 &&
      line.description.trim() !== '' &&
      !NOT_PRODUCT.test(line.description),
  );
  const best = goods.reduce<(typeof goods)[number] | undefined>(
    (top, line) => (!top || line.amountCents > top.amountCents ? line : top),
    undefined,
  );
  return best?.description.trim().slice(0, 120) ?? '';
}
