/**
 * "Este mês": what the household pays in a month. Invoices count in the month
 * they are due (or issued, when the due date is unknown); recurring expenses
 * typed by the user count in the months they are due. Each item can be marked
 * as paid; invoices paid by direct debit count as paid from the debit day on.
 * Invoices still to come count as forecasts, which cannot be marked as paid.
 * Pure: no React, no database.
 */
import type { Cents } from '../lib/money';
import type { ForecastInvoice } from './forecast';
import type { Contract, Invoice, Payment, RecurringExpense } from './types';

export interface MonthItem {
  /** Stable key, also the id of its "paid" mark. */
  paymentId: string;
  kind: 'invoice' | 'expense' | 'forecast';
  invoiceId?: string;
  expenseId?: string;
  /** Contract of a forecast invoice. */
  contractId?: string;
  /** Direct debit date, else due date, else the issue date of an invoice without one. */
  date: string;
  /** True when `date` is the due (or debit) date. */
  hasDueDate: boolean;
  /** Paid by direct debit on this day. */
  debitDate?: string;
  amountCents: Cents;
  paidOn?: string;
  /** Marked as paid by the app: from the direct debit date, or added as already paid. */
  autoPaid?: boolean;
  /** A forecast whose date has passed: the invoice has not been added. */
  late?: boolean;
}

export interface MonthSummary {
  month: string;
  items: MonthItem[];
  totalCents: Cents;
  paidCents: Cents;
  toPayCents: Cents;
  /** Part of the total that is forecast. */
  forecastCents: Cents;
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

export function lastDay(month: string): number {
  const [year, number] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** Between its first and last month (whether or not it is due in this one). */
export function expenseActive(
  expense: Pick<RecurringExpense, 'startMonth' | 'endMonth'>,
  month: string,
): boolean {
  return month >= expense.startMonth && (!expense.endMonth || month <= expense.endMonth);
}

/** Due date of a recurring expense in a month, or null when it is not due then. */
export function expenseDueDate(
  expense: Pick<RecurringExpense, 'startMonth' | 'endMonth' | 'everyMonths' | 'dueDay'>,
  month: string,
): string | null {
  if (!expenseActive(expense, month)) return null;
  if ((monthIndex(month) - monthIndex(expense.startMonth)) % expense.everyMonths !== 0) return null;
  const day = Math.min(Math.max(Math.trunc(expense.dueDay), 1), lastDay(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Amount of a recurring expense in a month (the latest change already started). */
export function expenseAmount(
  expense: Pick<RecurringExpense, 'amountCents' | 'amountChanges'>,
  month: string,
): Cents {
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

/**
 * Day the bank account is debited: printed on the invoice, else the due date
 * when the user said the contract is paid by direct debit.
 */
export function debitDateOf(
  invoice: Pick<Invoice, 'directDebitDate' | 'dueDate'>,
  contract?: Pick<Contract, 'directDebit'>,
): string | undefined {
  return invoice.directDebitDate ?? (contract?.directDebit ? invoice.dueDate : undefined);
}

/**
 * Whether an invoice is paid: the user's mark, else automatically from the
 * direct debit day on, unless the user said it was not paid (debit failed).
 */
export function invoicePaid(
  payment: Pick<Payment, 'paidOn' | 'unpaid'> | undefined,
  debitDate: string | undefined,
  today: string,
): { paidOn: string; auto: boolean } | null {
  if (payment?.paidOn) return { paidOn: payment.paidOn, auto: false };
  if (payment?.unpaid) return null;
  return debitDate && debitDate <= today ? { paidOn: debitDate, auto: true } : null;
}

/**
 * What unticking an item means: a paid mark the app made from the direct
 * debit says the debit failed; a mark the user made is just removed (the
 * direct debit, if its day has passed, marks it again).
 */
export function uncheckAction(item: Pick<MonthItem, 'autoPaid'>): 'unpaid' | 'remove' {
  return item.autoPaid ? 'unpaid' : 'remove';
}

export function monthSummary(
  month: string,
  invoices: readonly Invoice[],
  expenses: readonly RecurringExpense[],
  payments: readonly Payment[],
  options: {
    today?: string;
    contracts?: readonly Contract[];
    forecasts?: readonly ForecastInvoice[];
  } = {},
): MonthSummary {
  const byId = new Map(payments.map((payment) => [payment.id, payment]));
  const contracts = new Map((options.contracts ?? []).map((contract) => [contract.id, contract]));

  const items: MonthItem[] = [];
  for (const invoice of invoices) {
    const debitDate = debitDateOf(invoice, contracts.get(invoice.contractId));
    const date = debitDate ?? invoice.dueDate ?? invoice.issueDate;
    if (monthOf(date) !== month) continue;
    const id = paymentId({ invoiceId: invoice.id });
    const paid = invoicePaid(byId.get(id), debitDate, options.today ?? '');
    items.push({
      paymentId: id,
      kind: 'invoice',
      invoiceId: invoice.id,
      date,
      hasDueDate: debitDate !== undefined || invoice.dueDate !== undefined,
      ...(debitDate ? { debitDate } : {}),
      // Credit notes take money off the month.
      amountCents: invoice.totalCents,
      ...(paid ? { paidOn: paid.paidOn, ...(paid.auto ? { autoPaid: true } : {}) } : {}),
    });
  }
  for (const expense of expenses) {
    const date = expenseDueDate(expense, month);
    if (!date) continue;
    const id = paymentId({ expenseId: expense.id, month });
    // Like a direct debit on the due date: the user's own mark comes first.
    const alreadyPaid = expense.paidUntil !== undefined && date < expense.paidUntil;
    const paid = invoicePaid(byId.get(id), alreadyPaid ? date : undefined, date);
    items.push({
      paymentId: id,
      kind: 'expense',
      expenseId: expense.id,
      date,
      hasDueDate: true,
      amountCents: expenseAmount(expense, month),
      ...(paid ? { paidOn: paid.paidOn, ...(paid.auto ? { autoPaid: true } : {}) } : {}),
    });
  }
  for (const forecast of options.forecasts ?? []) {
    if (monthOf(forecast.date) !== month) continue;
    items.push({
      paymentId: `forecast-${forecast.contractId}-${forecast.issueDate}`,
      kind: 'forecast',
      contractId: forecast.contractId,
      date: forecast.date,
      hasDueDate: forecast.hasDueDate,
      ...(forecast.debit ? { debitDate: forecast.date } : {}),
      amountCents: forecast.amountCents,
      ...(options.today && forecast.date < options.today ? { late: true } : {}),
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId));

  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const paidCents = items
    .filter((item) => item.paidOn)
    .reduce((sum, item) => sum + item.amountCents, 0);
  const forecastCents = items
    .filter((item) => item.kind === 'forecast')
    .reduce((sum, item) => sum + item.amountCents, 0);
  return {
    month,
    items,
    totalCents,
    paidCents,
    toPayCents: totalCents - paidCents,
    forecastCents,
  };
}
