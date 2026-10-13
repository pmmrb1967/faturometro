import type { Confidence, ConsumptionPeriod, InvoiceLine, Reading, Sector } from '../domain/types';
import type { Cents } from '../lib/money';
import type { PageText } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';

/** A value read by a parser, with how sure the parser is about it. */
export interface Field<T> {
  value: T;
  confidence: Confidence;
}

export type ExtractedLine = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice' | 'period'
> & {
  /** VAT rate the line is taxed at, in percent (e.g. 23), when the invoice says so. */
  vatRate?: number;
  /** What a consumption line is based on, when the invoice says so. */
  basis?: Reading['readingType'] | 'adjustment';
};

export type ExtractedReading = Pick<Reading, 'quantity' | 'unit' | 'readingType' | 'dateTo'> & {
  period?: ConsumptionPeriod;
  /** Meter index, when printed. */
  meterReading?: number;
};

/** What a parser extracted for one invoice (one fiscal QR code). */
export interface ExtractedInvoice {
  sector?: Sector;
  docId?: Field<string>;
  issueDate?: Field<string>;
  periodStart?: Field<string>;
  periodEnd?: Field<string>;
  dueDate?: Field<string>;
  totalCents?: Field<Cents>;
  /** Total before VAT. */
  netCents?: Field<Cents>;
  vatCents?: Field<Cents>;
  customerNumber?: Field<string>;
  /** CPE (electricity) or CUI (gas). */
  supplyPointId?: Field<string>;
  tariffName?: Field<string>;
  powerKva?: Field<number>;
  loyaltyEndDate?: Field<string>;
  readingType?: Field<Reading['readingType']>;
  lines: ExtractedLine[];
  /** True when line amounts include VAT (they then add up to the total, not the net). */
  linesIncludeVat?: boolean;
  readings: ExtractedReading[];
  /** Problems the parser noticed (never thrown). */
  warnings: string[];
}

export interface ParserContext {
  pages: PageText[];
  /** Parsed fiscal QR codes of the document (may be empty). */
  qrs: FiscalQr[];
}

export interface Parser {
  id: string;
  /** Bump on every change; stored with each invoice. */
  version: string;
  sectors: Sector[];
  /** Issuer NIFs (field A of the QR code) handled by this layout. */
  issuerNifs: string[];
  /** Fallback when there is no QR code: does this text look like this layout? */
  detect(ctx: ParserContext): boolean;
  /**
   * Extracts one invoice. With several QR codes in one file, `qr` says which
   * one; without a QR code it is undefined. Never throws for missing fields.
   */
  parse(ctx: ParserContext, qr?: FiscalQr): ExtractedInvoice;
}

export function emptyExtraction(): ExtractedInvoice {
  return { lines: [], readings: [], warnings: [] };
}
