import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { INCOME_KINDS } from '../../domain/income';
import { expenseAmount, withAmountFrom } from '../../domain/month';
import type { Income, IncomeKind } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { centsToPtInput, parsePtAmount } from '../../lib/money';
import { EVERY, MONTH, ONE_OFF } from '../month/frequency';

const copy = t.spending.income;

export type SavedIncome = Omit<Income, 'updatedAt'>;

export function IncomeForm({
  initial,
  month,
  onDone,
}: {
  initial?: Income;
  month: string;
  onDone: (income: SavedIncome | null) => Promise<void>;
}) {
  const shownAmount = initial ? expenseAmount(initial, month) : undefined;
  const [kind, setKind] = useState<IncomeKind>(initial?.kind ?? 'salary');
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(
    shownAmount !== undefined ? centsToPtInput(shownAmount) : '',
  );
  const [fromMonth, setFromMonth] = useState(month);
  const [every, setEvery] = useState<Income['everyMonths'] | typeof ONE_OFF>(
    initial?.oneOff ? ONE_OFF : (initial?.everyMonths ?? 1),
  );
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 1));
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? month);
  const [endMonth, setEndMonth] = useState(initial?.oneOff ? '' : (initial?.endMonth ?? ''));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof copy.errors, string>>>({});
  const id = initial?.id ?? 'new';
  const amountCents = parsePtAmount(amount);
  const oneOff = every === ONE_OFF;
  // A new amount from a month on: earlier months keep theirs. A one-off has only one month.
  const amountChanged =
    !oneOff && shownAmount !== undefined && amountCents !== null && amountCents !== shownAmount;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const day = Number(dueDay);
    const found: typeof errors = {};
    if (amountCents === null || amountCents <= 0) found.amount = copy.errors.amount;
    if (!Number.isInteger(day) || day < 1 || day > 31) found.dueDay = copy.errors.dueDay;
    if (!MONTH.test(startMonth)) found.startMonth = copy.errors.startMonth;
    if (!oneOff && endMonth && (!MONTH.test(endMonth) || endMonth < startMonth)) {
      found.endMonth = copy.errors.endMonth;
    }
    if (amountChanged && (!MONTH.test(fromMonth) || fromMonth < startMonth)) {
      found.fromMonth = copy.errors.fromMonth;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    const common = {
      id: initial?.id ?? crypto.randomUUID(),
      kind,
      name: name.trim(),
      dueDay: day,
      startMonth,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };
    if (oneOff) {
      await onDone({ ...common, amountCents, everyMonths: 1, endMonth: startMonth, oneOff: true });
      return;
    }
    const income: SavedIncome = {
      ...common,
      // From a one-off income, the amount typed is the amount from the start.
      amountCents: initial && !initial.oneOff ? initial.amountCents : amountCents,
      ...(initial?.amountChanges && !initial.oneOff
        ? { amountChanges: initial.amountChanges }
        : {}),
      everyMonths: every,
      ...(endMonth ? { endMonth } : {}),
    };
    await onDone(amountChanged ? withAmountFrom(income, fromMonth, amountCents) : income);
  }

  return (
    <form className="month-form" onSubmit={(event) => void submit(event)} noValidate>
      <SelectField
        id={`income-kind-${id}`}
        label={copy.kind}
        value={kind}
        onChange={(event) => setKind(event.target.value as IncomeKind)}
      >
        {INCOME_KINDS.map((item) => (
          <option key={item} value={item}>
            {copy.kinds[item]}
          </option>
        ))}
      </SelectField>
      <Field
        id={`income-name-${id}`}
        label={copy.name}
        placeholder={copy.namePlaceholder}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Field
        id={`income-amount-${id}`}
        label={copy.amount}
        hint={copy.amountHint}
        inputMode="decimal"
        value={amount}
        error={errors.amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      {amountChanged && (
        <Field
          id={`income-from-${id}`}
          label={copy.fromMonth}
          hint={copy.fromMonthHint}
          type="month"
          value={fromMonth}
          error={errors.fromMonth}
          onChange={(event) => setFromMonth(event.target.value)}
        />
      )}
      <SelectField
        id={`income-every-${id}`}
        label={copy.every}
        value={every}
        hint={oneOff ? copy.oneOffHint : undefined}
        onChange={(event) =>
          setEvery(
            event.target.value === ONE_OFF
              ? ONE_OFF
              : (Number(event.target.value) as Income['everyMonths']),
          )
        }
      >
        {EVERY.map(({ months, label }) => (
          <option key={months} value={months}>
            {label}
          </option>
        ))}
        <option value={ONE_OFF}>{copy.oneOff}</option>
      </SelectField>
      <Field
        id={`income-day-${id}`}
        label={copy.dueDay}
        hint={copy.dueDayHint}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        value={dueDay}
        error={errors.dueDay}
        onChange={(event) => setDueDay(event.target.value)}
      />
      <Field
        id={`income-start-${id}`}
        label={oneOff ? copy.month : copy.startMonth}
        hint={oneOff ? undefined : copy.startMonthHint}
        type="month"
        value={startMonth}
        error={errors.startMonth}
        onChange={(event) => setStartMonth(event.target.value)}
      />
      {!oneOff && (
        <Field
          id={`income-end-${id}`}
          label={copy.endMonth}
          hint={copy.endMonthHint}
          type="month"
          value={endMonth}
          error={errors.endMonth}
          onChange={(event) => setEndMonth(event.target.value)}
        />
      )}
      <div className="month-actions">
        <button type="submit" className="action-primary">
          {copy.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => void onDone(null)}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
