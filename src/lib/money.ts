/** Monetary amounts are always integer cents. All conversions live here. */
export type Cents = number;

const PT_AMOUNT = /^(-)?(\d{1,3}(?:[. ]\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const DOT_DECIMAL_AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function toCents(
  sign: string | undefined,
  integerPart: string,
  decimals: string | undefined,
): Cents {
  const cents = Number(integerPart) * 100 + Number((decimals ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount out of range: ${integerPart}`);
  }
  return sign ? -cents : cents;
}

/**
 * Parses an amount as printed on Portuguese invoices: comma decimal separator,
 * optional dot or space thousands separators and optional euro sign
 * (e.g. "1.234,56 €"). Returns null when the text is not an amount.
 */
export function parsePtAmount(text: string): Cents | null {
  const normalized = text
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/€|EUR/gi, '')
    .trim();
  const match = PT_AMOUNT.exec(normalized);
  if (!match) return null;
  const [, sign, integerPart = '', decimals] = match;
  return toCents(sign, integerPart.replace(/[. ]/g, ''), decimals);
}

/**
 * Parses a machine-formatted amount with a dot decimal separator and no
 * thousands separator (e.g. "1234.56", as in the fiscal QR code).
 */
export function parseDotDecimalAmount(text: string): Cents | null {
  const match = DOT_DECIMAL_AMOUNT.exec(text.trim());
  if (!match) return null;
  const [, sign, integerPart = '', decimals] = match;
  return toCents(sign, integerPart, decimals);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    if (!Number.isInteger(value)) throw new TypeError(`Not integer cents: ${value}`);
    total += value;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('Sum out of range');
  return total;
}

/** Whole euros, rounded up (e.g. 3990 → 40): for "up to what you pay" limits. */
export function wholeEurosUp(cents: Cents): number {
  if (!Number.isInteger(cents)) throw new TypeError(`Not integer cents: ${cents}`);
  return Math.ceil(cents / 100);
}

const EUR_FORMAT = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });

/** Formats cents for display only (e.g. "1234,56 €"). */
export function formatCents(cents: Cents): string {
  return EUR_FORMAT.format(cents / 100);
}
