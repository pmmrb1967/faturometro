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

/**
 * The policy's next renewal: the day after the latest yearly receipt's period,
 * or the renewal letter's date, whichever is later. Monthly instalments (a
 * month's period) say nothing about the renewal. Undefined when unknown.
 */
export function insuranceRenewalDate(
  contract: Pick<Contract, 'insurance'>,
  invoices: readonly Pick<Invoice, 'periodStart' | 'periodEnd'>[],
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
  return [yearlyEnd ? nextDay(yearlyEnd) : undefined, contract.insurance?.renewal?.date]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}
