/**
 * "Este mês": what the household pays in a month. Invoices count in the month
 * they are due (or issued, when the due date is unknown); recurring expenses
 * typed by the user count in the months they are due. Each item can be marked
 * as paid. Pure: no React, no database.
 */
import type { Cents } from '../lib/money';
import type { Invoice, Payment, RecurringExpense } from './types';

export interface MonthItem {
  /** Stable key, also the id of its "paid" mark. */
  paymentId: string;
  kind: 'invoice' | 'expense';
  invoiceId?: string;
  expenseId?: string;
  /** Due date, or the issue date of an invoice without one. */
  date: string;
  /** True when `date` is the due date. */
  hasDueDate: boolean;
  amountCents: Cents;
  paidOn?: string;
}

export interface MonthSummary {
  month: string;
  items: MonthItem[];
  totalCents: Cents;
  paidCents: Cents;
  toPayCents: Cents;
}

/** Id of the "paid" mark of an invoice, or of one month of a recurring expense. */
export function paymentId(
  target: { invoiceId: string } | { expenseId: string; month: string },
): string {
  return 'invoiceId' in target
    ? `invoice-${target.invoiceId}`
    : `expense-${target.expenseId}-${target.month}`;
}

/** YYYY-MM of an ISO date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `count` months after `month` (YYYY-MM; negative goes back). */
export function addMonthsTo(month: string, count: number): string {
  const index = monthIndex(month) + count;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String(index - year * 12 + 1).padStart(2, '0')}`;
}

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function lastDay(month: string): number {
  const [year, number] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** Between its first and last month (whether or not it is due in this one). */
export function expenseActive(expense: RecurringExpense, month: string): boolean {
  return month >= expense.startMonth && (!expense.endMonth || month <= expense.endMonth);
}

/** Due date of a recurring expense in a month, or null when it is not due then. */
export function expenseDueDate(expense: RecurringExpense, month: string): string | null {
  if (!expenseActive(expense, month)) return null;
  if ((monthIndex(month) - monthIndex(expense.startMonth)) % expense.everyMonths !== 0) return null;
  const day = Math.min(Math.max(Math.trunc(expense.dueDay), 1), lastDay(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Amount of a recurring expense in a month (the latest change already started). */
export function expenseAmount(expense: RecurringExpense, month: string): Cents {
  let amount = expense.amountCents;
  for (const change of [...(expense.amountChanges ?? [])].sort((a, b) =>
    a.fromMonth.localeCompare(b.fromMonth),
  )) {
    if (change.fromMonth <= month) amount = change.amountCents;
  }
  return amount;
}

/**
 * A new amount from a month on: earlier months keep theirs; changes planned
 * from that month on are replaced. From the first month, it is the base amount.
 */
export function withAmountFrom<
  T extends Pick<RecurringExpense, 'amountCents' | 'amountChanges' | 'startMonth'>,
>(expense: T, fromMonth: string, amountCents: Cents): T {
  const { amountChanges = [], ...rest } = expense;
  if (fromMonth <= expense.startMonth) return { ...rest, amountCents } as T;
  const changes = [
    ...amountChanges.filter((change) => change.fromMonth < fromMonth),
    { fromMonth, amountCents },
  ];
  return { ...rest, amountChanges: changes } as T;
}

export function monthSummary(
  month: string,
  invoices: readonly Invoice[],
  expenses: readonly RecurringExpense[],
  payments: readonly Payment[],
): MonthSummary {
  const paid = new Map(payments.map((payment) => [payment.id, payment.paidOn]));
  const withPaid = (item: Omit<MonthItem, 'paidOn'>): MonthItem => {
    const paidOn = paid.get(item.paymentId);
    return paidOn ? { ...item, paidOn } : item;
  };

  const items: MonthItem[] = [];
  for (const invoice of invoices) {
    const date = invoice.dueDate ?? invoice.issueDate;
    if (monthOf(date) !== month) continue;
    items.push(
      withPaid({
        paymentId: paymentId({ invoiceId: invoice.id }),
        kind: 'invoice',
        invoiceId: invoice.id,
        date,
        hasDueDate: invoice.dueDate !== undefined,
        // Credit notes take money off the month.
        amountCents: invoice.totalCents,
      }),
    );
  }
  for (const expense of expenses) {
    const date = expenseDueDate(expense, month);
    if (!date) continue;
    items.push(
      withPaid({
        paymentId: paymentId({ expenseId: expense.id, month }),
        kind: 'expense',
        expenseId: expense.id,
        date,
        hasDueDate: true,
        amountCents: expenseAmount(expense, month),
      }),
    );
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId));

  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const paidCents = items
    .filter((item) => item.paidOn)
    .reduce((sum, item) => sum + item.amountCents, 0);
  return { month, items, totalCents, paidCents, toPayCents: totalCents - paidCents };
}
