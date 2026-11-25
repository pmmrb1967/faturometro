/**
 * One-off expenses used to be recurring expenses due in a single month
 * (`RecurringExpense.oneOff`), next to the purchases of "Gastos": two places
 * for the same thing. Moves each one, once, to a one-off expense
 * (`SpendingTransaction`) with the same id, still to pay or paid as it was,
 * and removes the old record and its "paid" mark. Nothing is written when
 * there is nothing to move, so synced devices do not send records again.
 * Runs locally on each device; the same id makes them write the same record.
 */
import type { Repositories } from '../../db/repositories';
import { expenseAmount, expenseDueDate, monthSummary, paymentId } from '../../domain/month';
import type { RecurringExpense, SpendingTransaction } from '../../domain/types';

type MovedTransaction = Omit<SpendingTransaction, 'updatedAt'>;

/** The one-off expense that takes the place of an old one, given its "paid" marks. */
export function oneOffAsTransaction(
  expense: RecurringExpense,
  payments: Parameters<typeof monthSummary>[3],
): MovedTransaction {
  const month = expense.startMonth;
  const date = expenseDueDate({ ...expense, everyMonths: 1, endMonth: month }, month)!;
  const item = monthSummary(month, [], [{ ...expense, endMonth: month }], payments, {
    today: date,
  }).items[0];
  const paidOn = item?.paidOn;
  return {
    id: expense.id,
    date,
    amountCents: expenseAmount(expense, month),
    category: expense.category ?? 'other',
    description: expense.name,
    source: 'manual',
    ...(paidOn ? (paidOn !== date ? { paidOn } : {}) : { toPay: true }),
    createdAt: expense.createdAt,
  };
}

/** Number of one-off expenses moved. */
export async function moveOneOffExpenses(repos: Repositories): Promise<number> {
  const expenses = (await repos.expenses.list()).filter((expense) => expense.oneOff);
  if (expenses.length === 0) return 0;
  const payments = await repos.payments.list();
  for (const expense of expenses) {
    // Already moved here (an older device sent the old record back): only the old one goes.
    if (!(await repos.transactions.get(expense.id))) {
      await repos.transactions.put(oneOffAsTransaction(expense, payments));
    }
    const mark = paymentId({ expenseId: expense.id, month: expense.startMonth });
    for (const payment of payments.filter(
      (candidate) => candidate.expenseId === expense.id || candidate.id === mark,
    )) {
      await repos.payments.remove(payment.id);
    }
    await repos.expenses.remove(expense.id);
  }
  return expenses.length;
}
