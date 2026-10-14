/**
 * "Quanto já poupaste" after a change of supplier: for each invoice of the new
 * contract since the change, what it would have cost with the old contract,
 * against what was paid. Always an estimate.
 *
 * - Electricity and gas: the old contract's prices (read from its latest
 *   detailed invoice) applied to the new invoice's real consumption and days,
 *   with the new invoice's taxes and charges (the same for every supplier), so
 *   consumption and weather do not count as savings.
 * - Otherwise, or when the invoices have no detailed lines: the old contract's
 *   cost per day × the days of each new invoice.
 */
import type { Cents } from '../lib/money';
import { breakdownFromLines, periodDays } from './contract-prices';
import { estimateCost, type Consumption, type Household } from './electricity-cost';
import { estimateGasCost, gasBreakdownFromLines, hasEarlierAdjustments } from './gas-cost';
import type { Invoice, InvoiceLine, Sector } from './types';

type Line = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice' | 'period'
>;

export interface SwitchInvoice {
  invoice: Pick<Invoice, 'issueDate' | 'periodStart' | 'periodEnd' | 'totalCents'>;
  lines: readonly Line[];
}

export interface SwitchInput {
  sector: Sector;
  /** Date of the change (ISO). */
  since: string;
  /** Invoices of the old contract. */
  before: readonly SwitchInvoice[];
  /** Invoices of the new contract. */
  after: readonly SwitchInvoice[];
  /** Electricity: contracted power and large family (VAT on energy). */
  household?: Household;
}

export interface SwitchSavings {
  /** New invoices counted. */
  invoices: number;
  paidCents: Cents;
  /** What they would have cost with the old contract. */
  wouldCents: Cents;
  /** Positive = cheaper since the change. */
  savingCents: Cents;
  /** How the old cost was estimated: with its prices, per day, or both. */
  method: 'prices' | 'perDay' | 'mixed';
}

/** Days of the old contract's latest invoices used for the cost per day. */
const RECENT = 3;
const DAYS_IN_MONTH = 365 / 12;

const startOf = ({ invoice }: SwitchInvoice) => invoice.periodStart ?? invoice.issueDate;
const daysOf = ({ invoice }: SwitchInvoice) =>
  invoice.periodStart && invoice.periodEnd && invoice.periodEnd >= invoice.periodStart
    ? periodDays(invoice.periodStart, invoice.periodEnd)
    : DAYS_IN_MONTH;
const newestFirst = (a: SwitchInvoice, b: SwitchInvoice) =>
  b.invoice.issueDate.localeCompare(a.invoice.issueDate);

function costPerDay(before: readonly SwitchInvoice[]): number | null {
  const recent = [...before].sort(newestFirst).slice(0, RECENT);
  const days = recent.reduce((sum, entry) => sum + daysOf(entry), 0);
  if (days <= 0) return null;
  return recent.reduce((sum, entry) => sum + entry.invoice.totalCents, 0) / days;
}

/** The new invoice's kWh split the way the old contract was priced; null when it cannot be. */
function asOldCycle(consumption: Consumption, oldPrices: Consumption): Consumption | null {
  const periods = Object.keys(consumption) as (keyof Consumption)[];
  if (periods.every((period) => oldPrices[period] !== undefined)) return consumption;
  if (oldPrices.simple !== undefined && Object.keys(oldPrices).length === 1) {
    const kwh = periods.reduce((sum, period) => sum + (consumption[period] ?? 0), 0);
    return { simple: kwh };
  }
  return null;
}

type Estimator = (entry: SwitchInvoice) => Cents | null;

function electricityEstimator(input: SwitchInput): Estimator | null {
  const household = input.household;
  if (!household) return null;
  const old = [...input.before]
    .sort(newestFirst)
    .map((entry) =>
      entry.invoice.periodStart && entry.invoice.periodEnd
        ? breakdownFromLines(entry.lines, daysOf(entry))
        : null,
    )
    .find((breakdown) => breakdown !== null);
  if (!old) return null;
  return (entry) => {
    if (!entry.invoice.periodStart || !entry.invoice.periodEnd) return null;
    const days = daysOf(entry);
    const current = breakdownFromLines(entry.lines, days);
    const consumption = current && asOldCycle(current.consumption, old.prices.energy);
    if (!current || !consumption) return null;
    return estimateCost(old.prices, consumption, days, household, current.common).totalCents;
  };
}

function gasEstimator(input: SwitchInput): Estimator | null {
  const old = [...input.before]
    .sort(newestFirst)
    .filter((entry) => !hasEarlierAdjustments(entry.lines))
    .map((entry) =>
      entry.invoice.periodStart && entry.invoice.periodEnd
        ? gasBreakdownFromLines(entry.lines, daysOf(entry))
        : null,
    )
    .find((breakdown) => breakdown !== null);
  if (!old) return null;
  return (entry) => {
    if (!entry.invoice.periodStart || !entry.invoice.periodEnd) return null;
    if (hasEarlierAdjustments(entry.lines)) return null;
    const days = daysOf(entry);
    const current = gasBreakdownFromLines(entry.lines, days);
    if (!current) return null;
    return estimateGasCost(old.prices, current.kwh, days, current.common).totalCents;
  };
}

/** Null when there is nothing to compare (no old invoices, or no new invoice since the change). */
export function switchSavings(input: SwitchInput): SwitchSavings | null {
  const after = input.after.filter((entry) => startOf(entry) >= input.since);
  const perDay = costPerDay(input.before);
  if (after.length === 0 || perDay === null) return null;

  const byPrices =
    input.sector === 'electricity'
      ? electricityEstimator(input)
      : input.sector === 'gas'
        ? gasEstimator(input)
        : null;

  let paid = 0;
  let would = 0;
  let priced = 0;
  for (const entry of after) {
    const estimate = byPrices?.(entry) ?? null;
    if (estimate !== null) priced++;
    paid += entry.invoice.totalCents;
    would += estimate ?? Math.round(perDay * daysOf(entry));
  }
  return {
    invoices: after.length,
    paidCents: paid,
    wouldCents: would,
    savingCents: would - paid,
    method: priced === after.length ? 'prices' : priced === 0 ? 'perDay' : 'mixed',
  };
}
