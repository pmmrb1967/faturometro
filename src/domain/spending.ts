/**
 * "Gastos": everything spent in a month, by category. Invoices and recurring
 * expenses are computed from what the app already has, the way forecasts are;
 * only one-off purchases are stored. Pure: no React, no database.
 */
import { sumCents, type Cents } from '../lib/money';
import { incomeMonth } from './income';
import { addMonthsTo, lastDay, monthOf, monthSummary } from './month';
import type {
  Contract,
  Income,
  Invoice,
  RecurringExpense,
  Sector,
  SpendingCategory,
  SpendingTransaction,
} from './types';

/** In display order of the category lists. */
export const SPENDING_CATEGORIES = [
  'food',
  'home',
  'bills',
  'transport',
  'health',
  'education',
  'leisure',
  'shopping',
  'insurance',
  'other',
] as const satisfies readonly SpendingCategory[];

const SECTOR_CATEGORY: Record<Sector, SpendingCategory> = {
  telecom: 'bills',
  electricity: 'bills',
  gas: 'bills',
  water: 'bills',
  insurance: 'insurance',
  other: 'other',
};

export interface SpendingItem {
  /** Stable key of the line. */
  id: string;
  kind: 'invoice' | 'expense' | 'transaction';
  invoiceId?: string;
  expenseId?: string;
  transactionId?: string;
  date: string;
  amountCents: Cents;
  category: SpendingCategory;
}

export interface SpendingMonth {
  month: string;
  /** Newest first. */
  items: SpendingItem[];
  totalCents: Cents;
  /** Only categories with spending, highest first. */
  byCategory: { category: SpendingCategory; totalCents: Cents }[];
  previousTotalCents: Cents;
}

export interface SpendingData {
  invoices: readonly Invoice[];
  expenses: readonly RecurringExpense[];
  transactions: readonly SpendingTransaction[];
  contracts: readonly Contract[];
}

function monthItems(month: string, data: SpendingData): SpendingItem[] {
  const sectors = new Map(data.contracts.map((contract) => [contract.id, contract.sector]));
  const invoices = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));
  const expenses = new Map(data.expenses.map((expense) => [expense.id, expense]));
  // A purchase whose document was later added as an invoice would count twice.
  const invoiced = new Set(data.invoices.map((invoice) => invoice.docKey));

  const items: SpendingItem[] = monthSummary(month, data.invoices, data.expenses, [], {
    contracts: data.contracts,
  }).items.map((item) => {
    if (item.kind === 'expense') {
      const expenseId = item.expenseId ?? '';
      return {
        id: `expense-${expenseId}-${month}`,
        kind: 'expense',
        expenseId,
        date: item.date,
        amountCents: item.amountCents,
        category: expenses.get(expenseId)?.category ?? 'other',
      };
    }
    const invoiceId = item.invoiceId ?? '';
    const sector = sectors.get(invoices.get(invoiceId)?.contractId ?? '');
    return {
      id: `invoice-${invoiceId}`,
      kind: 'invoice',
      invoiceId,
      date: item.date,
      amountCents: item.amountCents,
      category: sector ? SECTOR_CATEGORY[sector] : 'other',
    };
  });

  for (const transaction of data.transactions) {
    if (monthOf(transaction.date) !== month) continue;
    if (transaction.docKey && invoiced.has(transaction.docKey)) continue;
    items.push({
      id: `transaction-${transaction.id}`,
      kind: 'transaction',
      transactionId: transaction.id,
      date: transaction.date,
      amountCents: transaction.amountCents,
      category: transaction.category,
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** In display order of the selector; the first is the default. */
export const SPENDING_ORDERS = ['date', 'amount', 'type', 'category'] as const;
export type SpendingOrder = (typeof SPENDING_ORDERS)[number];

const KIND_RANK: Record<SpendingItem['kind'], number> = { invoice: 0, expense: 1, transaction: 2 };

/** Movements in another order; a tie keeps the date order of the list. */
export function sortSpendingItems(
  items: readonly SpendingItem[],
  order: SpendingOrder,
): SpendingItem[] {
  const rank: Record<SpendingOrder, (item: SpendingItem) => number> = {
    date: () => 0,
    amount: (item) => -item.amountCents,
    type: (item) => KIND_RANK[item.kind],
    category: (item) => SPENDING_CATEGORIES.indexOf(item.category),
  };
  return [...items].sort((a, b) => rank[order](a) - rank[order](b));
}

function total(items: readonly SpendingItem[]): Cents {
  return sumCents(items.map((item) => item.amountCents));
}

export function spendingMonth(month: string, data: SpendingData): SpendingMonth {
  const items = monthItems(month, data);
  const byCategory = SPENDING_CATEGORIES.flatMap((category) => {
    const inCategory = items.filter((item) => item.category === category);
    return inCategory.length > 0 ? [{ category, totalCents: total(inCategory) }] : [];
  }).sort((a, b) => b.totalCents - a.totalCents);
  return {
    month,
    items,
    totalCents: total(items),
    byCategory,
    previousTotalCents: total(monthItems(addMonthsTo(month, -1), data)),
  };
}

/** Spent up to the end of each day: position 0 is day 1. */
export interface MonthProgress {
  /** Longest of the two months, for the axis. */
  days: number;
  /** Stops today in the current month: what is still due has not been spent. */
  current: Cents[];
  previous: Cents[];
}

function cumulative(items: readonly SpendingItem[], days: number): Cents[] {
  let total = 0;
  return Array.from({ length: days }, (_, index) => {
    for (const item of items) {
      if (Number(item.date.slice(8, 10)) === index + 1) total += item.amountCents;
    }
    return total;
  });
}

/** Null for a month still to come, which has nothing spent yet. */
export function monthProgress(
  month: string,
  data: SpendingData,
  today: string,
): MonthProgress | null {
  if (month > monthOf(today)) return null;
  const previousMonth = addMonthsTo(month, -1);
  const days = lastDay(month);
  const until = month === monthOf(today) ? Number(today.slice(8, 10)) : days;
  return {
    days: Math.max(days, lastDay(previousMonth)),
    current: cumulative(monthItems(month, data), days).slice(0, until),
    previous: cumulative(monthItems(previousMonth, data), lastDay(previousMonth)),
  };
}

/** A year month by month: position 0 is January; null is a month with nothing recorded. */
export interface YearProgress {
  year: string;
  /** Stops today: what is still due has not been spent. */
  current: (Cents | null)[];
  previous: (Cents | null)[];
  /** What came in each month, up to the last month of `current`. */
  income: (Cents | null)[];
  /** January to the last month with spending; null when the year has none yet. */
  spent: { lastMonth: number; totalCents: Cents } | null;
  /** Only the months recorded in both years, up to the same day of the same month. */
  compared: { months: number; currentCents: Cents; previousCents: Cents } | null;
  /** First month with purchases, when only one side of the comparison has them. */
  purchasesSince: string | null;
}

/** Null for a year still to come, or with nothing recorded in it or in the one before. */
export function yearProgress(
  year: string,
  data: SpendingData,
  incomes: readonly Income[],
  today: string,
): YearProgress | null {
  if (year > today.slice(0, 4)) return null;
  const previousYear = addMonthsTo(`${year}-01`, -12).slice(0, 4);
  const spentIn = (month: string, until?: string): Cents | null => {
    const items = monthItems(month, data).filter((item) => !until || item.date <= until);
    return items.length > 0 ? total(items) : null;
  };
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  const past = (index: number) => `${year}-${months[index]}` <= monthOf(today);

  const current = months.map((month, index) =>
    past(index) ? spentIn(`${year}-${month}`, today) : null,
  );
  const previous = months.map((month) => spentIn(`${previousYear}-${month}`));
  if ([...current, ...previous].every((value) => value === null)) return null;

  const income = months.map((month, index) => {
    const entered = incomeMonth(`${year}-${month}`, incomes);
    return past(index) && entered.items.length > 0 ? entered.totalCents : null;
  });

  const lastMonth = current.findLastIndex((value) => value !== null);
  const spent =
    lastMonth >= 0 ? { lastMonth, totalCents: sumCents(current.map((value) => value ?? 0)) } : null;

  const sameDay = year === today.slice(0, 4) ? `${previousYear}${today.slice(4)}` : undefined;
  const both = months.flatMap((month, index) => {
    const now = current[index] ?? null;
    return now !== null && previous[index] !== null ? [{ month, now }] : [];
  });
  const compared =
    both.length > 0
      ? {
          months: both.length,
          currentCents: sumCents(both.map(({ now }) => now)),
          previousCents: sumCents(
            both.map(({ month }) => spentIn(`${previousYear}-${month}`, sameDay) ?? 0),
          ),
        }
      : null;

  const since = data.transactions.map(({ date }) => monthOf(date)).sort()[0];
  const unfair =
    since !== undefined &&
    both.some(({ month }) => `${year}-${month}` >= since && `${previousYear}-${month}` < since);

  return {
    year,
    current,
    previous,
    income,
    spent,
    compared,
    purchasesSince: unfair ? since : null,
  };
}

/** Share of the month (whole percent); credit notes do not make it pass 100. */
export function categoryShare(
  categoryCents: Cents,
  byCategory: SpendingMonth['byCategory'],
): number {
  const positive = sumCents(byCategory.map((entry) => Math.max(entry.totalCents, 0)));
  if (positive === 0 || categoryCents <= 0) return 0;
  return Math.round((categoryCents * 100) / positive);
}

/** What the user chose the last time they bought from this issuer. */
export function lastFromIssuer(
  transactions: readonly SpendingTransaction[],
  issuerNif: string,
): SpendingTransaction | undefined {
  return transactions
    .filter((transaction) => transaction.issuerNif === issuerNif)
    .reduce<SpendingTransaction | undefined>(
      (latest, transaction) => (!latest || transaction.date > latest.date ? transaction : latest),
      undefined,
    );
}
