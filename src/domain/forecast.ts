/**
 * Invoices still to come: for each active contract with at least two
 * invoices (or one yearly insurance receipt), the next ones at its usual
 * rhythm, with an estimated amount, up to a number of months ahead. Never stored: recomputed from the invoices, so a
 * real invoice takes the place of its forecast as soon as it is added.
 * Pure: no React, no database.
 */
import type { Cents } from '../lib/money';
import { daysBetween, invoiceRhythm, median } from './alerts';
import { isYearlyReceipt } from './insurance';
import { addMonthsTo, debitDateOf, monthOf } from './month';
import type { Contract, Invoice, Sector } from './types';

/** Months after the current one with forecasts. */
export const FORECAST_MONTHS = 12;
/** Amounts that depend on consumption, and so on the time of year. */
const SEASONAL: ReadonlySet<Sector> = new Set(['electricity', 'gas', 'water']);
/** Invoices looked at for the payment delay. */
const RECENT_INVOICES = 7;
/** Invoices averaged when there is none from the same time last year. */
const AVERAGE_INVOICES = 3;
/** Days around one year earlier where an invoice counts as the same time of year. */
const SAME_SEASON_DAYS = 20;
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365;
const DAY_MS = 86_400_000;

export interface ForecastInvoice {
  contractId: string;
  /** Expected issue date. */
  issueDate: string;
  /** Expected payment date: direct debit or due date, else the issue date. */
  date: string;
  /** True when `date` is a due (or debit) date. */
  hasDueDate: boolean;
  /** Paid by direct debit on `date`. */
  debit: boolean;
  amountCents: Cents;
}

/** Forecasts paid from the month of `today` to `months` months later. */
export function forecastInvoices(
  contracts: readonly Contract[],
  invoices: readonly Invoice[],
  today: string,
  months = FORECAST_MONTHS,
): ForecastInvoice[] {
  const firstMonth = monthOf(today);
  const lastMonth = addMonthsTo(firstMonth, months);
  const forecasts: ForecastInvoice[] = [];
  for (const contract of contracts) {
    if (!contract.active) continue;
    // Credit notes are not bills to pay, and would break the rhythm.
    const history = invoices
      .filter((invoice) => invoice.contractId === contract.id && invoice.totalCents > 0)
      .sort(
        (a, b) => a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt),
      );
    const latest = history.at(-1);
    if (!latest) continue;
    // A single yearly receipt is enough: the policy renews every year.
    const intervalDays =
      invoiceRhythm(history, 1)?.intervalDays ??
      (contract.sector === 'insurance' && isYearlyReceipt(latest) ? DAYS_PER_YEAR : null);
    if (intervalDays === null) continue;
    const payment = paymentDelay(history.slice(-RECENT_INVOICES), contract);
    const next = stepper(intervalDays);
    for (let count = 1; ; count++) {
      const issueDate = next(latest.issueDate, count);
      const date = payment ? addDays(issueDate, payment.days) : issueDate;
      if (monthOf(date) > lastMonth) break;
      if (monthOf(date) < firstMonth) continue;
      forecasts.push({
        contractId: contract.id,
        issueDate,
        date,
        hasDueDate: payment !== null,
        debit: payment?.debit ?? false,
        amountCents: estimate(contract, history, issueDate, date),
      });
    }
  }
  return forecasts.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Days from issue to payment, from the recent invoices, and whether the latest
 * is paid by direct debit; null when none says when it is paid.
 */
function paymentDelay(
  recent: readonly Invoice[],
  contract: Contract,
): { days: number; debit: boolean } | null {
  const delays = recent.flatMap((invoice) => {
    const paid = debitDateOf(invoice, contract) ?? invoice.dueDate;
    return paid && paid >= invoice.issueDate ? [daysBetween(invoice.issueDate, paid)] : [];
  });
  if (delays.length === 0) return null;
  return { days: median(delays), debit: debitDateOf(recent.at(-1)!, contract) !== undefined };
}

/**
 * Next issue dates: on the same day of the month when the rhythm is a whole
 * number of months (monthly, bimonthly, yearly), so they do not drift; else
 * every so many days.
 */
function stepper(intervalDays: number): (from: string, count: number) => string {
  const months = Math.round(intervalDays / DAYS_PER_MONTH);
  if (months >= 1 && Math.abs(intervalDays - months * DAYS_PER_MONTH) <= 3 + months) {
    return (from, count) => addCalendarMonths(from, months * count);
  }
  return (from, count) => addDays(from, intervalDays * count);
}

/**
 * Consumption sectors: the invoice from the same time last year, else the
 * average of the latest ones. The others: the latest invoice, with the new
 * premium of a renewal letter from the renewal on.
 */
function estimate(
  contract: Contract,
  history: readonly Invoice[],
  issueDate: string,
  date: string,
): Cents {
  const latest = history.at(-1)!;
  if (!SEASONAL.has(contract.sector)) return renewed(contract, latest, date) ?? latest.totalCents;
  const yearAgo = history
    .map((invoice) => ({
      invoice,
      off: Math.abs(daysBetween(invoice.issueDate, issueDate) - 365),
    }))
    .filter(({ off }) => off <= SAME_SEASON_DAYS)
    .sort((a, b) => a.off - b.off)[0];
  if (yearAgo) return yearAgo.invoice.totalCents;
  const recent = history.slice(-AVERAGE_INVOICES);
  return Math.round(recent.reduce((sum, invoice) => sum + invoice.totalCents, 0) / recent.length);
}

/**
 * The latest receipt at the premium of the renewal letter, for a payment on or
 * after the renewal, when that receipt is from before it. In proportion, so a
 * monthly instalment goes up as much as the yearly premium.
 */
function renewed(contract: Contract, latest: Invoice, date: string): Cents | null {
  const renewal = contract.insurance?.renewal;
  if (contract.sector !== 'insurance' || !renewal || renewal.currentCents <= 0) return null;
  if (date < renewal.date) return null;
  const covers =
    latest.periodStart ?? debitDateOf(latest, contract) ?? latest.dueDate ?? latest.issueDate;
  if (covers >= renewal.date) return null;
  return Math.round((latest.totalCents * renewal.nextCents) / renewal.currentCents);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Same day `count` months later, or the month's last day when it is shorter. */
function addCalendarMonths(date: string, count: number): string {
  const month = addMonthsTo(monthOf(date), count);
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0')}`;
}
