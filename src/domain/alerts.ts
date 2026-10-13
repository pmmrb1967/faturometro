/**
 * Alert rules (PLAN.md §9). Pure: given contracts, invoices, lines, readings,
 * settings and today's date, returns the alerts that should exist now.
 * Each alert has a stable key, so recomputing replaces it and a dismissed
 * alert stays dismissed.
 */
import type { Alert, Contract, Invoice, InvoiceLine, Reading, Sector, Settings } from './types';

export const MISSING_INVOICE_DAYS = 40;
export const ESTIMATED_IN_A_ROW = 3;
const PRICE_HISTORY = 3;
/** Total-based price rule only where the total does not depend on consumption. */
const FIXED_PRICE_SECTORS: readonly Sector[] = ['telecom', 'other'];
const ENERGY_SECTORS: readonly Sector[] = ['electricity', 'gas'];

export type AlertDraft = Omit<Alert, 'id' | 'updatedAt' | 'createdAt' | 'message'> & {
  /** Stable identity: same situation → same key. */
  key: string;
};

export interface AlertInput {
  contracts: Contract[];
  invoices: Invoice[];
  lines: InvoiceLine[];
  readings: Reading[];
  settings: Pick<Settings, 'priceIncreaseThresholdPct' | 'loyaltyAlertDays'>;
  /** ISO date. */
  today: string;
}

const DAY_MS = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function byDate(a: Invoice, b: Invoice): number {
  return a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt);
}

function loyaltyAlert(contract: Contract, input: AlertInput): AlertDraft | null {
  if (!contract.loyaltyEndDate) return null;
  const daysLeft = daysBetween(input.today, contract.loyaltyEndDate);
  if (daysLeft < 0) return null;
  // The smallest threshold already reached (60 → 30 → 7): a new alert at each step.
  const reached = [...input.settings.loyaltyAlertDays]
    .sort((a, b) => a - b)
    .find((threshold) => daysLeft <= threshold);
  if (reached === undefined) return null;
  return {
    key: `${contract.id}:loyalty_ending:${contract.loyaltyEndDate}:${reached}`,
    contractId: contract.id,
    kind: 'loyalty_ending',
    severity: daysLeft <= 30 ? 'warning' : 'info',
    data: { endDate: contract.loyaltyEndDate, daysLeft, threshold: reached },
  };
}

function baseFee(lines: InvoiceLine[]): number | null {
  const fees = lines.filter((line) => line.kind === 'base_fee');
  return fees.length > 0 ? fees.reduce((sum, line) => sum + line.amountCents, 0) : null;
}

/** Energy price in €/kWh (or €/m³), weighted by quantity; null when the invoice has no unit prices. */
function energyUnitPrice(lines: InvoiceLine[]): number | null {
  const energy = lines.filter(
    (line) => line.kind === 'energy' && line.unitPrice !== undefined && (line.quantity ?? 0) > 0,
  );
  const quantity = energy.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  if (quantity === 0) return null;
  return (
    energy.reduce((sum, line) => sum + Number(line.unitPrice) * (line.quantity ?? 0), 0) / quantity
  );
}

function priceAlert(
  contract: Contract,
  history: Invoice[],
  linesOf: (invoice: Invoice) => InvoiceLine[],
  input: AlertInput,
): AlertDraft | null {
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest || !previous) return null;
  const threshold = input.settings.priceIncreaseThresholdPct / 100;
  const make = (reason: string, before: number, after: number): AlertDraft => ({
    key: `${contract.id}:price_increase:${latest.id}`,
    contractId: contract.id,
    kind: 'price_increase',
    severity: 'warning',
    data: {
      invoiceId: latest.id,
      reason,
      before,
      after,
      increasePct: ((after - before) / before) * 100,
    },
  });

  // Monthly base fee went up (any sector that bills one).
  const feeNow = baseFee(linesOf(latest));
  const feeBefore = baseFee(linesOf(previous));
  if (feeNow !== null && feeBefore !== null && feeBefore > 0 && feeNow > feeBefore) {
    return make('base_fee', feeBefore, feeNow);
  }

  if (ENERGY_SECTORS.includes(contract.sector)) {
    const priceNow = energyUnitPrice(linesOf(latest));
    const priceBefore = energyUnitPrice(linesOf(previous));
    if (priceNow !== null && priceBefore !== null && priceNow > priceBefore * (1 + threshold)) {
      return make('unit_price', priceBefore, priceNow);
    }
    return null;
  }

  if (FIXED_PRICE_SECTORS.includes(contract.sector)) {
    const earlier = history.slice(-1 - PRICE_HISTORY, -1);
    if (earlier.length < PRICE_HISTORY) return null;
    const average = earlier.reduce((sum, invoice) => sum + invoice.totalCents, 0) / earlier.length;
    if (average > 0 && latest.totalCents > average * (1 + threshold)) {
      return make('total', Math.round(average), latest.totalCents);
    }
  }
  return null;
}

function estimatedAlert(
  contract: Contract,
  history: Invoice[],
  readingsOf: (invoice: Invoice) => Reading[],
): AlertDraft | null {
  let streak = 0;
  for (const invoice of [...history].reverse()) {
    const readings = readingsOf(invoice);
    if (readings.length > 0 && readings.every((reading) => reading.readingType === 'estimated')) {
      streak++;
    } else {
      break;
    }
  }
  if (streak < ESTIMATED_IN_A_ROW) return null;
  const latest = history.at(-1);
  return {
    key: `${contract.id}:estimated_readings:${latest?.id}`,
    contractId: contract.id,
    kind: 'estimated_readings',
    severity: 'warning',
    data: { count: streak },
  };
}

function missingAlert(contract: Contract, history: Invoice[], today: string): AlertDraft | null {
  const latest = history.at(-1);
  if (!contract.active || !latest) return null;
  const days = daysBetween(latest.issueDate, today);
  if (days <= MISSING_INVOICE_DAYS) return null;
  return {
    key: `${contract.id}:missing_invoice:${latest.id}`,
    contractId: contract.id,
    kind: 'missing_invoice',
    severity: 'info',
    data: { lastIssueDate: latest.issueDate, days },
  };
}

export function computeAlerts(input: AlertInput): AlertDraft[] {
  const linesByInvoice = groupBy(input.lines, (line) => line.invoiceId);
  const readingsByInvoice = groupBy(input.readings, (reading) => reading.invoiceId);
  const invoicesByContract = groupBy(input.invoices, (invoice) => invoice.contractId);
  const linesOf = (invoice: Invoice) => linesByInvoice.get(invoice.id) ?? [];
  const readingsOf = (invoice: Invoice) => readingsByInvoice.get(invoice.id) ?? [];

  return input.contracts
    .filter((contract) => contract.active)
    .flatMap((contract) => {
      const history = [...(invoicesByContract.get(contract.id) ?? [])].sort(byDate);
      return [
        loyaltyAlert(contract, input),
        priceAlert(contract, history, linesOf, input),
        estimatedAlert(contract, history, readingsOf),
        missingAlert(contract, history, input.today),
      ].filter((alert): alert is AlertDraft => alert !== null);
    });
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}
