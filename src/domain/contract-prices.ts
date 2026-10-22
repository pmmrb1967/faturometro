/**
 * Reads the current contract's prices, the charges common to every offer and
 * the consumption from an electricity invoice's lines (as saved from a parser).
 */
import type { CommonCharges, Consumption, Prices } from './electricity-cost';
import type { InvoiceLine } from './types';

type Line = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice' | 'period'
>;

const SOCIAL = /social/i;
const AUDIOVISUAL = /audiovisual/i;
const IEC = /imposto especial|\bIEC\b/i;

const periodKey = (line: Line): keyof Consumption => {
  switch (line.period) {
    case 'empty':
      return 'empty';
    case 'off_empty':
      return 'offEmpty';
    case 'full':
      return 'full';
    case 'peak':
      return 'peak';
    default:
      return 'simple';
  }
};

export interface InvoiceBreakdown {
  prices: Prices;
  common: CommonCharges;
  consumption: Consumption;
}

/** null when the invoice does not have priced energy lines (e.g. read without a parser). */
export function breakdownFromLines(lines: readonly Line[], days: number): InvoiceBreakdown | null {
  const energy = lines.filter(
    (line) =>
      line.kind === 'energy' &&
      line.unit === 'kWh' &&
      line.unitPrice !== undefined &&
      (line.quantity ?? 0) > 0,
  );
  if (energy.length === 0 || days <= 0) return null;

  const consumption: Consumption = {};
  const cost: Consumption = {};
  for (const line of energy) {
    const key = periodKey(line);
    consumption[key] = (consumption[key] ?? 0) + (line.quantity ?? 0);
    cost[key] = (cost[key] ?? 0) + (line.quantity ?? 0) * Number(line.unitPrice);
  }
  const prices: Prices = { fixedPerDay: 0, energy: {} };
  for (const key of Object.keys(consumption) as (keyof Consumption)[]) {
    prices.energy[key] = (cost[key] ?? 0) / (consumption[key] ?? 1);
  }
  const kwh = Object.values(consumption).reduce((sum, value) => sum + (value ?? 0), 0);
  const energyGross = Object.values(cost).reduce((sum, value) => sum + (value ?? 0), 0);

  // Power: every positive €/day power line (supplier term + network term).
  prices.fixedPerDay = lines
    .filter(
      (line) =>
        line.kind === 'power' &&
        line.unit === 'day' &&
        Number(line.unitPrice) > 0 &&
        !SOCIAL.test(line.description),
    )
    .reduce((sum, line) => sum + Number(line.unitPrice), 0);

  // Commercial discounts of the current offer (e-invoice, direct debit…): % of energy.
  const offerDiscounts = lines.filter(
    (line) => line.kind === 'discount' && !SOCIAL.test(line.description),
  );
  const discount = -offerDiscounts.reduce((sum, line) => sum + line.amountCents, 0) / 100;
  if (discount > 0 && energyGross > 0) prices.energyDiscountPct = (discount / energyGross) * 100;

  const common: CommonCharges = { perKwh: 0, normalPerKwh: 0, reducedPerDay: 0, normalPerDay: 0 };
  const isOfferLine = (line: Line) =>
    energy.includes(line) ||
    offerDiscounts.includes(line) ||
    (line.kind === 'power' && Number(line.unitPrice) > 0 && !SOCIAL.test(line.description)) ||
    (line.kind === 'energy' && line.unitPrice === undefined); // adjustments of earlier periods
  for (const line of lines) {
    if (isOfferLine(line)) continue;
    const euros = line.amountCents / 100;
    // The IEC (and its exemption) takes 23 %, not the energy's split: docs/electricity-vat.md.
    if (line.unit === 'kWh' && IEC.test(line.description)) common.normalPerKwh += euros / kwh;
    else if (line.unit === 'kWh') common.perKwh += euros / kwh;
    else if (AUDIOVISUAL.test(line.description)) common.reducedPerDay += euros / days;
    else common.normalPerDay += euros / days;
  }
  return { prices, common, consumption };
}

/** Inclusive number of days between two ISO dates. */
export function periodDays(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
  );
}
