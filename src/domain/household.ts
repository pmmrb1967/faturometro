/**
 * The household's year (PLAN.md §13, next actions): what the last 12 months
 * cost, month by month and by sector, against the 12 before, and an estimate
 * of the next 12. Each invoice counts in the month it was issued (what was
 * paid that month). Pure, no React.
 */
import type { Cents } from '../lib/money';
import type { Contract, Invoice, Sector } from './types';

export interface HouseholdInput {
  contracts: Pick<Contract, 'id' | 'sector' | 'active'>[];
  invoices: Pick<
    Invoice,
    'contractId' | 'issueDate' | 'periodStart' | 'periodEnd' | 'totalCents'
  >[];
  /** ISO date. */
  today: string;
}

export interface HouseholdSummary {
  /** The last 12 months, oldest first ("YYYY-MM"), including the current one, by sector too. */
  months: { month: string; totalCents: Cents; bySector: Partial<Record<Sector, Cents>> }[];
  totalCents: Cents;
  /** The 12 months before, only when the history covers all of them. */
  previousTotalCents?: Cents;
  /** Sectors with spending in the last 12 months, largest first. */
  bySector: { sector: Sector; totalCents: Cents }[];
  /** Next 12 months for the active contracts with invoices; null without any. */
  forecastCents: Cents | null;
}

const YEARLY_SECTORS: readonly Sector[] = ['electricity', 'gas', 'water'];
/** Invoices used for the daily average. */
const RECENT = 3;
const DAYS_IN_YEAR = 365;
const DAYS_IN_MONTH = DAYS_IN_YEAR / 12;

/** "2026-10" plus `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const monthOf = (iso: string) => iso.slice(0, 7);

function days(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

type ForecastInvoice = HouseholdInput['invoices'][number];

/**
 * A contract's next 12 months. Metered services with a whole year of history
 * repeat that year (winter and summer included); otherwise the cost per day of
 * the latest invoices (monthly when an invoice has no billing period) × 365.
 */
export function contractForecast(
  sector: Sector,
  invoices: readonly ForecastInvoice[],
  firstMonth: string,
): Cents | null {
  const sorted = [...invoices].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  if (sorted.length === 0) return null;
  const first = sorted[0]!;
  if (YEARLY_SECTORS.includes(sector) && monthOf(first.issueDate) < firstMonth) {
    return sorted
      .filter((invoice) => monthOf(invoice.issueDate) >= firstMonth)
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
  }
  const recent = sorted.slice(-RECENT);
  const covered = recent.reduce(
    (sum, invoice) =>
      sum +
      (invoice.periodStart && invoice.periodEnd && invoice.periodEnd >= invoice.periodStart
        ? days(invoice.periodStart, invoice.periodEnd)
        : DAYS_IN_MONTH),
    0,
  );
  const paid = recent.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  return Math.round((paid / covered) * DAYS_IN_YEAR);
}

export function householdSummary(input: HouseholdInput): HouseholdSummary {
  const current = monthOf(input.today);
  const firstMonth = addMonths(current, -11);
  const previousFirst = addMonths(current, -23);
  const sectorOf = new Map(input.contracts.map((contract) => [contract.id, contract.sector]));

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: addMonths(firstMonth, i),
    totalCents: 0,
    bySector: {} as Partial<Record<Sector, Cents>>,
  }));
  const monthIndex = new Map(months.map((entry, i) => [entry.month, i]));
  const sectors = new Map<Sector, Cents>();
  let previousTotal = 0;
  let earliest: string | undefined;

  for (const invoice of input.invoices) {
    const month = monthOf(invoice.issueDate);
    if (!earliest || month < earliest) earliest = month;
    const index = monthIndex.get(month);
    if (index !== undefined) {
      const entry = months[index]!;
      entry.totalCents += invoice.totalCents;
      const sector = sectorOf.get(invoice.contractId) ?? 'other';
      entry.bySector[sector] = (entry.bySector[sector] ?? 0) + invoice.totalCents;
      sectors.set(sector, (sectors.get(sector) ?? 0) + invoice.totalCents);
    } else if (month >= previousFirst && month < firstMonth) {
      previousTotal += invoice.totalCents;
    }
  }

  const byContract = new Map<string, ForecastInvoice[]>();
  for (const invoice of input.invoices) {
    const list = byContract.get(invoice.contractId);
    if (list) list.push(invoice);
    else byContract.set(invoice.contractId, [invoice]);
  }
  const forecasts = input.contracts
    .filter((contract) => contract.active)
    .map((contract) =>
      contractForecast(contract.sector, byContract.get(contract.id) ?? [], firstMonth),
    )
    .filter((value): value is Cents => value !== null);

  return {
    months,
    totalCents: months.reduce((sum, entry) => sum + entry.totalCents, 0),
    ...(earliest !== undefined && earliest <= previousFirst
      ? { previousTotalCents: previousTotal }
      : {}),
    bySector: [...sectors]
      .filter(([, total]) => total !== 0)
      .map(([sector, totalCents]) => ({ sector, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents),
    forecastCents: forecasts.length > 0 ? forecasts.reduce((sum, value) => sum + value, 0) : null,
  };
}
