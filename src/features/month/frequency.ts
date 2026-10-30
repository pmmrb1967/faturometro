import type { RecurringExpense } from '../../domain/types';
import { t } from '../../i18n/pt-PT';

/** Choices of a form for something that repeats. */
export const EVERY: { months: RecurringExpense['everyMonths']; label: string }[] = [
  { months: 1, label: t.frequency.monthly },
  { months: 2, label: t.frequency.bimonthly },
  { months: 3, label: t.frequency.quarterly },
  { months: 4, label: t.month.expenses.fourMonthly },
  { months: 6, label: t.frequency.semiannual },
  { months: 12, label: t.frequency.annual },
];
/** Select value of something that happens once (the others use their number of months). */
export const ONE_OFF = 'once';
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function frequencyOf(entry: Pick<RecurringExpense, 'everyMonths' | 'oneOff'>): string {
  if (entry.oneOff) return t.month.expenses.oneOff;
  return EVERY.find((every) => every.months === entry.everyMonths)?.label ?? t.frequency.monthly;
}
