/**
 * Fiscal QR code parser, following the AT technical specification v1.1
 * (docs/qr-fiscal.md). Pure: no PDF, no DOM.
 */
import { parseDotDecimalAmount, sumCents, type Cents } from '../lib/money';

export interface TaxRegion {
  /** TaxCountryRegion (PT, PT-AC, PT-MA, FR…), or "0" for documents without VAT rate. */
  region: string;
  exemptBase?: Cents;
  reducedBase?: Cents;
  reducedVat?: Cents;
  intermediateBase?: Cents;
  intermediateVat?: Cents;
  normalBase?: Cents;
  normalVat?: Cents;
}

export interface FiscalQr {
  raw: string;
  /** A */
  issuerNif: string;
  /** B (999999990 = final consumer) */
  buyerNif?: string;
  /** C */
  buyerCountry?: string;
  /** D */
  docType?: string;
  /** E */
  docStatus?: string;
  /** F, as ISO YYYY-MM-DD */
  date: string;
  /** G */
  docId?: string;
  /** H */
  atcud?: string;
  /** I, J, K */
  taxRegions: TaxRegion[];
  /** L */
  notSubjectCents?: Cents;
  /** M */
  stampDutyCents?: Cents;
  /** N: VAT + stamp duty */
  totalTaxesCents?: Cents;
  /** O */
  totalCents: Cents;
  /** P */
  withholdingCents?: Cents;
  /** Q */
  hash4?: string;
  /** R */
  certificate?: string;
  /** S */
  other?: string;
}

export type QrParseResult =
  | { ok: true; qr: FiscalQr; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const MANDATORY = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I1', 'N', 'O', 'Q', 'R'] as const;
const REGION_PREFIXES = ['I', 'J', 'K'] as const;
const REGION_FIELDS = [
  'exemptBase',
  'reducedBase',
  'reducedVat',
  'intermediateBase',
  'intermediateVat',
  'normalBase',
  'normalVat',
] as const;

/** True if the text looks like a Portuguese fiscal QR code. */
export function looksLikeFiscalQr(text: string): boolean {
  return /^\s*A:\s*\d+\s*\*\s*B:/.test(text);
}

function isoDate(yyyymmdd: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function parseFiscalQr(raw: string): QrParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields = new Map<string, string>();

  for (const part of raw.trim().split('*')) {
    const separator = part.indexOf(':');
    if (separator < 0) {
      warnings.push(`Field without code ignored: "${part}"`);
      continue;
    }
    // The spec forbids spaces, but real programs (and the spec's own examples) add them.
    const code = part.slice(0, separator).trim().toUpperCase();
    const value = part.slice(separator + 1).trim();
    if (fields.has(code)) warnings.push(`Duplicate field ${code}`);
    else fields.set(code, value);
  }

  for (const code of MANDATORY) {
    if (!fields.has(code)) {
      const critical = code === 'A' || code === 'F' || code === 'O';
      (critical ? errors : warnings).push(`Missing mandatory field ${code}`);
    }
  }

  const amount = (code: string): Cents | undefined => {
    const value = fields.get(code);
    if (value === undefined) return undefined;
    const cents = parseDotDecimalAmount(value);
    if (cents === null) {
      (code === 'O' ? errors : warnings).push(`Invalid amount in ${code}: "${value}"`);
      return undefined;
    }
    if (!/\.\d{2}$/.test(value)) warnings.push(`${code} should have two decimal places`);
    return cents;
  };

  const issuerNif = fields.get('A') ?? '';
  if (issuerNif && !/^\d{9}$/.test(issuerNif))
    errors.push(`Invalid issuer NIF in A: "${issuerNif}"`);

  const rawDate = fields.get('F');
  const date = rawDate === undefined ? null : isoDate(rawDate);
  if (rawDate !== undefined && date === null) errors.push(`Invalid date in F: "${rawDate}"`);

  const taxRegions: TaxRegion[] = [];
  for (const prefix of REGION_PREFIXES) {
    const region = fields.get(`${prefix}1`);
    if (region === undefined) continue;
    const entry: TaxRegion = { region };
    REGION_FIELDS.forEach((name, index) => {
      const cents = amount(`${prefix}${index + 2}`);
      if (cents !== undefined) entry[name] = cents;
    });
    taxRegions.push(entry);
  }

  const totalCents = amount('O');
  if (errors.length > 0 || totalCents === undefined || date === null) {
    return { ok: false, errors, warnings };
  }

  const qr: FiscalQr = { raw, issuerNif, date, taxRegions, totalCents };
  const optionalText = {
    buyerNif: 'B',
    buyerCountry: 'C',
    docType: 'D',
    docStatus: 'E',
    docId: 'G',
    atcud: 'H',
    hash4: 'Q',
    certificate: 'R',
    other: 'S',
  } as const;
  for (const [key, code] of Object.entries(optionalText)) {
    const value = fields.get(code);
    if (value !== undefined) qr[key as keyof typeof optionalText] = value;
  }
  const optionalAmounts = {
    notSubjectCents: 'L',
    stampDutyCents: 'M',
    totalTaxesCents: 'N',
    withholdingCents: 'P',
  } as const;
  for (const [key, code] of Object.entries(optionalAmounts)) {
    const cents = amount(code);
    if (cents !== undefined) qr[key as keyof typeof optionalAmounts] = cents;
  }

  return { ok: true, qr, warnings };
}

/** VAT only (excluding stamp duty): sum of the VAT fields of every tax region. */
export function vatCents(qr: FiscalQr): Cents {
  return sumCents(
    qr.taxRegions.flatMap((region) => [
      region.reducedVat ?? 0,
      region.intermediateVat ?? 0,
      region.normalVat ?? 0,
    ]),
  );
}

/** Credit notes reduce what was paid. */
export function signedTotalCents(qr: FiscalQr): Cents {
  return qr.docType === 'NC' ? -qr.totalCents : qr.totalCents;
}
