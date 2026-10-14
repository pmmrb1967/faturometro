/**
 * Electricity comparator (PLAN.md §8): annual consumption from the user's
 * readings, current cost from the latest invoice's prices, and the estimated
 * annual cost of every valid ERSE offer for the same power. "Estimativa",
 * never "poupança garantida".
 */
import { breakdownFromLines, periodDays, type InvoiceBreakdown } from './contract-prices';
import { estimateCost, type Consumption, type Household, type Prices } from './electricity-cost';
import { powerKey, type CycleCode, type CyclePrices, type Offer } from './erse';
import type { Invoice, InvoiceLine, Reading } from './types';

const YEAR = 365;

export interface AnnualUsage {
  /** kWh per year by meter period (empty/full/peak/offEmpty) and in total. */
  byPeriod: Partial<Record<'empty' | 'offEmpty' | 'full' | 'peak', number>>;
  total: number;
  /** Days of real data behind the estimate (< 365 → extrapolated). */
  daysCovered: number;
}

/** Readings of invoices whose period ends in the last 12 months, scaled to a year. */
export function annualUsage(
  invoices: Invoice[],
  readings: Reading[],
  today: string,
): AnnualUsage | null {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - YEAR);
  const recent = invoices.filter(
    (invoice) =>
      invoice.periodStart &&
      invoice.periodEnd &&
      invoice.periodEnd > since.toISOString().slice(0, 10),
  );
  const ids = new Set(recent.map((invoice) => invoice.id));
  const daysCovered = recent.reduce(
    (sum, invoice) => sum + periodDays(invoice.periodStart!, invoice.periodEnd!),
    0,
  );
  const kwhReadings = readings.filter(
    (reading) => ids.has(reading.invoiceId) && reading.unit === 'kWh',
  );
  if (daysCovered === 0 || kwhReadings.length === 0) return null;

  const scale = YEAR / daysCovered;
  const byPeriod: AnnualUsage['byPeriod'] = {};
  let total = 0;
  for (const reading of kwhReadings) {
    total += reading.quantity;
    const key = reading.period === 'off_empty' ? 'offEmpty' : reading.period;
    if (key) byPeriod[key] = (byPeriod[key] ?? 0) + reading.quantity;
  }
  for (const key of Object.keys(byPeriod) as (keyof AnnualUsage['byPeriod'])[]) {
    byPeriod[key] = (byPeriod[key] ?? 0) * scale;
  }
  return { byPeriod, total: total * scale, daysCovered };
}

/** Consumption split for an ERSE cycle, or null when the readings cannot split it. */
export function consumptionFor(cycle: CycleCode, usage: AnnualUsage): Consumption | null {
  const { empty, offEmpty, full, peak } = usage.byPeriod;
  if (cycle === '1') return { simple: usage.total };
  if (cycle === '2') {
    if (empty === undefined) return null;
    const rest =
      offEmpty ??
      (full !== undefined || peak !== undefined ? (full ?? 0) + (peak ?? 0) : undefined);
    return rest === undefined ? null : { empty, offEmpty: rest };
  }
  if (empty === undefined || full === undefined || peak === undefined) return null;
  return { empty, full, peak };
}

function offerPrices(offer: Offer, prices: CyclePrices): Prices {
  return {
    fixedPerDay: prices.fixedPerDay,
    energy: {
      ...(prices.simple !== undefined ? { simple: prices.simple } : {}),
      ...(prices.offEmpty !== undefined ? { offEmpty: prices.offEmpty } : {}),
      ...(prices.empty !== undefined ? { empty: prices.empty } : {}),
      ...(prices.full !== undefined ? { full: prices.full } : {}),
      ...(prices.peak !== undefined ? { peak: prices.peak } : {}),
    },
    fixedTermDiscountPct: offer.discounts.fixedTermPct,
    energyDiscountPct: offer.discounts.energyPct,
    energyDiscountPerKwh: offer.discounts.energyPerKwh,
    discountPerYear: offer.discounts.fixedPerYear,
    servicesPerYearWithVat: offer.servicesPerYearWithVat,
  };
}

export interface OfferResult {
  offer: Offer;
  cycle: CycleCode;
  annualCents: number;
  /** Positive = cheaper than the current contract. */
  savingCents: number;
}

export interface Comparison {
  usage: AnnualUsage;
  currentAnnualCents: number;
  results: OfferResult[];
}

export interface CompareInput {
  offers: Offer[];
  /** Lines and period of the latest electricity invoice (current prices and common charges). */
  latest: { lines: InvoiceLine[]; periodStart: string; periodEnd: string };
  usage: AnnualUsage;
  household: Household;
  today: string;
}

function currentBreakdown(input: CompareInput): InvoiceBreakdown | null {
  return breakdownFromLines(
    input.latest.lines,
    periodDays(input.latest.periodStart, input.latest.periodEnd),
  );
}

/** Annual consumption split the way the current contract is billed. */
function currentConsumption(breakdown: InvoiceBreakdown, usage: AnnualUsage): Consumption | null {
  const billed = Object.keys(breakdown.consumption) as (keyof Consumption)[];
  if (billed.length === 1 && billed[0] === 'simple') return { simple: usage.total };
  if (billed.includes('full') || billed.includes('peak')) return consumptionFor('3', usage);
  return consumptionFor('2', usage);
}

export function compareOffers(input: CompareInput): Comparison | null {
  const breakdown = currentBreakdown(input);
  if (!breakdown) return null;
  const consumption = currentConsumption(breakdown, input.usage);
  if (!consumption) return null;
  const current = estimateCost(
    breakdown.prices,
    consumption,
    YEAR,
    input.household,
    breakdown.common,
  );

  const key = powerKey(input.household.powerKva);
  const results: OfferResult[] = [];
  for (const offer of input.offers) {
    if (offer.validFrom && offer.validFrom > input.today) continue;
    if (offer.validTo && offer.validTo < input.today) continue;
    const byCycle = offer.prices[key];
    if (!byCycle) continue;
    for (const cycle of ['1', '2', '3'] as const) {
      const prices = byCycle[cycle];
      const split = prices ? consumptionFor(cycle, input.usage) : null;
      if (!prices || !split) continue;
      const estimate = estimateCost(
        offerPrices(offer, prices),
        split,
        YEAR,
        input.household,
        breakdown.common,
      );
      results.push({
        offer,
        cycle,
        annualCents: estimate.totalCents,
        savingCents: current.totalCents - estimate.totalCents,
      });
    }
  }
  results.sort((a, b) => a.annualCents - b.annualCents);
  return { usage: input.usage, currentAnnualCents: current.totalCents, results };
}
