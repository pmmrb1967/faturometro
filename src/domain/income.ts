/**
 * Income on the page "Gastos": what comes in, in the month it comes in. It
 * repeats by the rules of recurring expenses. Pure: no React, no database.
 */
import { sumCents, type Cents } from '../lib/money';
import { expenseAmount, expenseDueDate } from './month';
import type { Income, IncomeKind } from './types';

/** In display order of the kind list. */
export const INCOME_KINDS = [
  'salary',
  'rent',
  'interest',
  'dividends',
  'bonus',
  'other',
] as const satisfies readonly IncomeKind[];

export interface IncomeItem {
  /** Stable key of the line. */
  id: string;
  incomeId: string;
  date: string;
  amountCents: Cents;
}

export interface IncomeMonth {
  month: string;
  /** First to come in, first. */
  items: IncomeItem[];
  totalCents: Cents;
}

export function incomeMonth(month: string, incomes: readonly Income[]): IncomeMonth {
  const items = incomes
    .flatMap((income) => {
      const date = expenseDueDate(income, month);
      if (!date) return [];
      return [
        {
          id: `income-${income.id}-${month}`,
          incomeId: income.id,
          date,
          amountCents: expenseAmount(income, month),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { month, items, totalCents: sumCents(items.map((item) => item.amountCents)) };
}
