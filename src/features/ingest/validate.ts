/**
 * Step 5 (PLAN.md §6): cross-validation of an extraction (parser or AI)
 * against the fiscal QR code and its own internal consistency.
 */
import type { Confidence, Invoice, Sector } from '../../domain/types';
import { sumCents } from '../../lib/money';
import type { ExtractedInvoice } from '../../parsers/types';
import { addDays } from '../../parsers/utils';
import { vatCents, type FiscalQr } from '../../qr/parse';

/** ±1 cent (PLAN.md: tolerance 0,01 €). */
const TOLERANCE_CENTS = 1;
const ISSUE_SLACK_DAYS = 5;
/** Consumption-based sectors bill the past; telecom bills the coming month in advance. */
const BILLED_IN_ARREARS: readonly Sector[] = ['electricity', 'gas', 'water'];
/** Insurance receipts can be issued weeks before the period they pay for starts. */
const INSURANCE_ADVANCE_DAYS = 60;

export type Check = 'total' | 'vat' | 'period' | 'lines' | 'readings';

export interface ValidationResult {
  validation: Invoice['validation'];
  failures: Check[];
  /** Confidence per invoice field after the checks. */
  confidence: Partial<Record<string, Confidence>>;
}

const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_CENTS;

/** kWh billed are often rounded to whole units, while meters read decimals. */
const KWH_TOLERANCE_PER_LINE = 1;

/**
 * Meter readings add up to the kWh billed, per reading type when the lines
 * say what they are based on (estimated periods have no reading; adjustments
 * of earlier estimates are ignored).
 */
function readingsMatchBilled(extracted: ExtractedInvoice): boolean {
  const energy = extracted.lines.filter(
    (line) => line.kind === 'energy' && line.unit === 'kWh' && line.basis !== 'adjustment',
  );
  const readings = extracted.readings.filter((reading) => reading.unit === 'kWh');
  if (energy.length === 0 || readings.length === 0) return true;

  const typed = energy.some((line) => line.basis !== undefined);
  const groups = typed
    ? [...new Set(readings.map((reading) => reading.readingType))].map((type) => ({
        lines: energy.filter((line) => line.basis === type),
        readings: readings.filter((reading) => reading.readingType === type),
      }))
    : [{ lines: energy, readings }];

  return groups.every((group) => {
    const billed = group.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
    const read = group.readings.reduce((sum, reading) => sum + reading.quantity, 0);
    if (billed === 0) return true;
    return Math.abs(billed - read) <= KWH_TOLERANCE_PER_LINE * Math.max(1, group.lines.length);
  });
}

export function validateExtraction(extracted: ExtractedInvoice, qr?: FiscalQr): ValidationResult {
  const failures: Check[] = [];
  const confidence: Partial<Record<string, Confidence>> = {};
  for (const [field, value] of Object.entries(extracted)) {
    if (value && typeof value === 'object' && 'confidence' in value) {
      confidence[field] = (value as { confidence: Confidence }).confidence;
    }
  }
  const fail = (check: Check, fields: string[]) => {
    failures.push(check);
    for (const field of fields) confidence[field] = 'low';
  };

  if (qr) {
    if (extracted.totalCents && !close(extracted.totalCents.value, qr.totalCents)) {
      fail('total', ['totalCents']);
    }
    if (extracted.vatCents && !close(extracted.vatCents.value, vatCents(qr))) {
      fail('vat', ['vatCents']);
    }
  }

  const start = extracted.periodStart?.value;
  const end = extracted.periodEnd?.value;
  const issue = qr?.date ?? extracted.issueDate?.value;
  if (start && end) {
    const slack = extracted.sector === 'insurance' ? INSURANCE_ADVANCE_DAYS : ISSUE_SLACK_DAYS;
    const limit = issue ? addDays(issue, slack) : undefined;
    const arrears = extracted.sector === undefined || BILLED_IN_ARREARS.includes(extracted.sector);
    const ok = start <= end && (!limit || (arrears ? end <= limit : start <= limit));
    if (!ok) fail('period', ['periodStart', 'periodEnd']);
  }

  if (extracted.lines.length > 0) {
    const expected = extracted.linesIncludeVat
      ? (extracted.totalCents?.value ?? qr?.totalCents)
      : extracted.netCents?.value;
    const lines = sumCents(extracted.lines.map((line) => line.amountCents));
    if (expected !== undefined && !close(lines, expected)) fail('lines', ['lines']);
  }

  if (!readingsMatchBilled(extracted)) fail('readings', ['readings']);

  return {
    validation: qr ? (failures.length === 0 ? 'passed' : 'failed') : 'not_checked',
    failures,
    confidence,
  };
}
