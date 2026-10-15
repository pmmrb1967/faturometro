/** Insurance policies: when they renew. */
import type { Contract, Invoice } from './types';

/** A receipt covering at least this many days pays a whole year (not a monthly instalment). */
const YEARLY_PERIOD_DAYS = 300;
const DAY_MS = 86_400_000;

function days(start: string, end: string): number {
  return (
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1
  );
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** The first anniversary of `start` on or after `today` ("2026-05-01" → "2027-05-01"). */
function nextAnniversary(start: string, today: string): string {
  const [year = 0, month = 1, day = 1] = start.split('-').map(Number);
  for (let candidate = Math.max(year, Number(today.slice(0, 4)) - 1); ; candidate++) {
    // 29 February falls on 1 March in other years.
    const date = new Date(Date.UTC(candidate, month - 1, day)).toISOString().slice(0, 10);
    if (date >= today && date > start) return date;
  }
}

/**
 * The policy's next renewal, the latest of: the day after the latest yearly
 * receipt's period, the renewal letter's date, and (with `today`) the next
 * anniversary of the contract's start date. Monthly instalments say nothing
 * about the renewal. Undefined when unknown.
 */
export function insuranceRenewalDate(
  contract: Pick<Contract, 'insurance'>,
  invoices: readonly Pick<Invoice, 'periodStart' | 'periodEnd'>[],
  today?: string,
): string | undefined {
  const yearlyEnd = invoices
    .filter(
      (invoice) =>
        invoice.periodStart &&
        invoice.periodEnd &&
        days(invoice.periodStart, invoice.periodEnd) >= YEARLY_PERIOD_DAYS,
    )
    .map((invoice) => invoice.periodEnd!)
    .sort()
    .at(-1);
  const start = contract.insurance?.startDate;
  return [
    yearlyEnd ? nextDay(yearlyEnd) : undefined,
    contract.insurance?.renewal?.date,
    start && today ? nextAnniversary(start, today) : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}
