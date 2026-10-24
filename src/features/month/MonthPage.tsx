import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import {
  addMonthsTo,
  expenseActive,
  expenseAmount,
  monthOf,
  monthSummary,
  uncheckAction,
  withAmountFrom,
  type MonthItem,
} from '../../domain/month';
import type { Payment, RecurringExpense } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount } from '../../lib/money';
import { refreshAlerts, today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import '../invoices/invoices.css';
import './month.css';

const copy = t.month;
const EVERY: { months: RecurringExpense['everyMonths']; label: string }[] = [
  { months: 1, label: t.frequency.monthly },
  { months: 2, label: t.frequency.bimonthly },
  { months: 3, label: t.frequency.quarterly },
  { months: 4, label: copy.expenses.fourMonthly },
  { months: 6, label: t.frequency.semiannual },
  { months: 12, label: t.frequency.annual },
];
/** Select value of a one-off expense (the others use their number of months). */
const ONE_OFF = 'once';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthName = new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatMonth(month: string): string {
  return monthName.format(new Date(`${month}-01T00:00:00Z`));
}

function frequencyOf(expense: RecurringExpense): string {
  if (expense.oneOff) return copy.expenses.oneOff;
  return EVERY.find((every) => every.months === expense.everyMonths)?.label ?? t.frequency.monthly;
}

type SavedExpense = Omit<RecurringExpense, 'updatedAt'>;

/** "Este mês": what is due in a month, marked as paid or not, and expenses without an invoice. */
export function MonthPage() {
  const { session } = useSession();
  const [month, setMonth] = useState(monthOf(today()));
  // Expense being changed, in its line of the month or in the expenses section.
  const [editing, setEditing] = useState<{ id: string; place: 'line' | 'section' } | null>(null);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [invoices, contracts, providers, expenses, payments] = await Promise.all([
      session.repos.invoices.list(),
      session.repos.contracts.list(),
      session.repos.providers.list(),
      session.repos.expenses.list(),
      session.repos.payments.list(),
    ]);
    return {
      invoices: new Map(invoices.map((invoice) => [invoice.id, invoice])),
      contracts: new Map(contracts.map((contract) => [contract.id, contract])),
      providers: new Map(providers.map((provider) => [provider.id, provider])),
      expenses,
      payments,
    };
  }, [session]);

  if (!session || !data) return null;
  const repos = session.repos;
  const date = today();
  const summary = monthSummary(month, [...data.invoices.values()], data.expenses, data.payments, {
    today: date,
    contracts: [...data.contracts.values()],
  });
  // Expenses between their first and last month (due this month or not).
  const active = data.expenses
    .filter((expense) => expenseActive(expense, month))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  const nameOf = (item: MonthItem): string => {
    if (item.kind === 'expense') {
      return data.expenses.find((expense) => expense.id === item.expenseId)?.name ?? '';
    }
    const invoice = data.invoices.get(item.invoiceId ?? '');
    const provider = invoice && data.providers.get(invoice.providerId)?.name;
    const label = invoice && data.contracts.get(invoice.contractId)?.label;
    return [provider, label].filter(Boolean).join(' — ');
  };

  async function setPaid(item: MonthItem, paid: boolean) {
    const target = {
      id: item.paymentId,
      ...(item.invoiceId ? { invoiceId: item.invoiceId } : {}),
      ...(item.expenseId ? { expenseId: item.expenseId, month } : {}),
    };
    if (paid) {
      const payment: Omit<Payment, 'updatedAt'> = { ...target, paidOn: date };
      await repos.payments.put(payment);
    } else if (uncheckAction(item) === 'unpaid') {
      // The direct debit failed: say so, or the app marks it as paid again.
      const payment: Omit<Payment, 'updatedAt'> = { ...target, unpaid: true };
      await repos.payments.put(payment);
    } else {
      await repos.payments.remove(item.paymentId);
    }
    // The prescription and payment alerts depend on it.
    await refreshAlerts(repos);
  }

  async function saveExpense(expense: SavedExpense | null) {
    if (expense) await repos.expenses.put(expense);
    setEditing(null);
  }

  const goTo = (next: string) => {
    setEditing(null);
    setMonth(next);
  };

  return (
    <>
      <h1>{t.nav.month}</h1>
      <p className="muted">{copy.intro}</p>

      <div className="month-nav">
        <button
          type="button"
          className="action-secondary"
          aria-label={copy.previous}
          title={copy.previous}
          onClick={() => goTo(addMonthsTo(month, -1))}
        >
          ←
        </button>
        <h2 className="month-title" aria-live="polite">
          {formatMonth(month)}
        </h2>
        <button
          type="button"
          className="action-secondary"
          aria-label={copy.next}
          title={copy.next}
          onClick={() => goTo(addMonthsTo(month, 1))}
        >
          →
        </button>
      </div>

      <dl className="facts">
        <div>
          <dt>{copy.total}</dt>
          <dd>{formatCents(summary.totalCents)}</dd>
        </div>
        <div>
          <dt>{copy.paid}</dt>
          <dd>{formatCents(summary.paidCents)}</dd>
        </div>
        <div>
          <dt>{copy.toPay}</dt>
          <dd>
            <strong>{formatCents(summary.toPayCents)}</strong>
          </dd>
        </div>
      </dl>

      {summary.items.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <ul className="list">
          {summary.items.map((item) => {
            const name = nameOf(item);
            const expense = data.expenses.find((candidate) => candidate.id === item.expenseId);
            if (expense && editing?.id === expense.id && editing.place === 'line') {
              return (
                <li key={item.paymentId}>
                  <ExpenseForm initial={expense} month={month} onDone={saveExpense} />
                </li>
              );
            }
            return (
              <li
                key={item.paymentId}
                className={`list-item month-item${item.paidOn ? ' is-paid' : ''}`}
              >
                <label className="month-check">
                  <input
                    type="checkbox"
                    checked={item.paidOn !== undefined}
                    aria-label={copy.paidLabel(name)}
                    onChange={(event) => void setPaid(item, event.target.checked)}
                  />
                  <span aria-hidden="true">{copy.paidCheck}</span>
                </label>
                <strong>{name}</strong>
                <span className="amount">{formatCents(item.amountCents)}</span>
                <span className="meta">
                  {item.debitDate
                    ? copy.debit(formatIsoDate(item.debitDate))
                    : item.hasDueDate
                      ? copy.due(formatIsoDate(item.date))
                      : copy.issued(formatIsoDate(item.date))}
                  {item.paidOn &&
                    ` · ${item.autoPaid ? copy.autoPaid : copy.paidOn(formatIsoDate(item.paidOn))}`}
                  {item.kind === 'expense' && ` · ${copy.expenseTag}`}
                </span>
                {expense && (
                  <ExpenseActions
                    expense={expense}
                    onEdit={() => setEditing({ id: expense.id, place: 'line' })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="expenses-title">
        <h2 id="expenses-title" className="section-title">
          {copy.expenses.title}
        </h2>
        <p className="muted">{copy.expenses.intro}</p>
        {active.length === 0 && (
          <p className="muted">
            {data.expenses.length === 0 ? copy.expenses.empty : copy.expenses.emptyMonth}
          </p>
        )}
        <ul className="list">
          {active.map((expense) =>
            editing?.id === expense.id && editing.place === 'section' ? (
              <li key={expense.id}>
                <ExpenseForm initial={expense} month={month} onDone={saveExpense} />
              </li>
            ) : (
              <li key={expense.id} className="list-item month-expense">
                <strong>{expense.name}</strong>
                <span className="meta">
                  {copy.expenses.summary(
                    formatCents(expenseAmount(expense, month)),
                    frequencyOf(expense),
                    expense.dueDay,
                  )}
                  {' · '}
                  {expense.oneOff
                    ? copy.expenses.inMonth(formatMonth(expense.startMonth))
                    : expense.endMonth
                      ? copy.expenses.between(
                          formatMonth(expense.startMonth),
                          formatMonth(expense.endMonth),
                        )
                      : copy.expenses.since(formatMonth(expense.startMonth))}
                </span>
                <ExpenseActions
                  expense={expense}
                  stopFrom={expense.oneOff ? undefined : month}
                  onEdit={() => setEditing({ id: expense.id, place: 'section' })}
                />
              </li>
            ),
          )}
        </ul>
        {editing?.id === 'new' ? (
          <ExpenseForm month={month} onDone={saveExpense} />
        ) : (
          <p>
            <button
              type="button"
              className="action-primary"
              onClick={() => setEditing({ id: 'new', place: 'section' })}
            >
              {copy.expenses.add}
            </button>
          </p>
        )}
      </section>
    </>
  );
}

/** Change, stop or delete a recurring expense; deleting asks first. */
function ExpenseActions({
  expense,
  stopFrom,
  onEdit,
}: {
  expense: RecurringExpense;
  /** Month from which "Já não pago" stops it (only in the expenses section). */
  stopFrom?: string;
  onEdit: () => void;
}) {
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const repos = session.repos;

  async function remove() {
    const payments = await repos.payments.list();
    for (const payment of payments.filter((candidate) => candidate.expenseId === expense.id)) {
      await repos.payments.remove(payment.id);
    }
    await repos.expenses.remove(expense.id);
  }

  async function stop(month: string) {
    const endMonth = addMonthsTo(month, -1);
    if (endMonth < expense.startMonth) setConfirming(true);
    else await repos.expenses.put({ ...expense, endMonth });
  }

  if (confirming) {
    return (
      <div className="month-confirm" role="alert">
        <p>{copy.expenses.confirmRemove(expense.name)}</p>
        <div className="month-actions">
          <button type="button" className="action-secondary danger" onClick={() => void remove()}>
            {copy.expenses.confirm}
          </button>
          <button type="button" className="action-secondary" onClick={() => setConfirming(false)}>
            {copy.expenses.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="month-actions">
      <button type="button" className="action-secondary" onClick={onEdit}>
        {copy.expenses.edit}
      </button>
      {stopFrom && (
        <button
          type="button"
          className="action-secondary"
          aria-label={copy.expenses.stopLabel(expense.name, formatMonth(stopFrom))}
          onClick={() => void stop(stopFrom)}
        >
          {copy.expenses.stop}
        </button>
      )}
      <button
        type="button"
        className="action-secondary danger"
        aria-label={`${copy.expenses.remove}: ${expense.name}`}
        onClick={() => setConfirming(true)}
      >
        {copy.expenses.remove}
      </button>
    </div>
  );
}

function ExpenseForm({
  initial,
  month,
  onDone,
}: {
  initial?: RecurringExpense;
  month: string;
  onDone: (expense: SavedExpense | null) => Promise<void>;
}) {
  const shownAmount = initial ? expenseAmount(initial, month) : undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(
    shownAmount !== undefined ? centsToPtInput(shownAmount) : '',
  );
  const [fromMonth, setFromMonth] = useState(month);
  const [every, setEvery] = useState<RecurringExpense['everyMonths'] | typeof ONE_OFF>(
    initial?.oneOff ? ONE_OFF : (initial?.everyMonths ?? 1),
  );
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 1));
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? month);
  const [endMonth, setEndMonth] = useState(initial?.oneOff ? '' : (initial?.endMonth ?? ''));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof copy.expenses.errors, string>>>(
    {},
  );
  const id = initial?.id ?? 'new';
  const amountCents = parsePtAmount(amount);
  const oneOff = every === ONE_OFF;
  // A new amount on an existing expense: from which month (earlier ones keep theirs).
  // A one-off expense has a single month, so its amount is simply replaced.
  const amountChanged =
    !oneOff && shownAmount !== undefined && amountCents !== null && amountCents !== shownAmount;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const day = Number(dueDay);
    const found: typeof errors = {};
    if (!name.trim()) found.name = copy.expenses.errors.name;
    if (amountCents === null || amountCents <= 0) found.amount = copy.expenses.errors.amount;
    if (!Number.isInteger(day) || day < 1 || day > 31) found.dueDay = copy.expenses.errors.dueDay;
    if (!MONTH.test(startMonth)) found.startMonth = copy.expenses.errors.startMonth;
    if (!oneOff && endMonth && (!MONTH.test(endMonth) || endMonth < startMonth)) {
      found.endMonth = copy.expenses.errors.endMonth;
    }
    if (amountChanged && (!MONTH.test(fromMonth) || fromMonth < startMonth)) {
      found.fromMonth = copy.expenses.errors.fromMonth;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    const common = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      dueDay: day,
      startMonth,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };
    if (oneOff) {
      // Due only in its month, also for app versions that do not know `oneOff`.
      await onDone({
        ...common,
        amountCents,
        everyMonths: 1,
        endMonth: startMonth,
        oneOff: true,
      });
      return;
    }
    const expense: SavedExpense = {
      ...common,
      // From a one-off expense, the amount typed is the amount from the start.
      amountCents: initial && !initial.oneOff ? initial.amountCents : amountCents,
      ...(initial?.amountChanges && !initial.oneOff
        ? { amountChanges: initial.amountChanges }
        : {}),
      everyMonths: every,
      ...(endMonth ? { endMonth } : {}),
    };
    await onDone(amountChanged ? withAmountFrom(expense, fromMonth, amountCents) : expense);
  }

  return (
    <form className="month-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        id={`expense-name-${id}`}
        label={copy.expenses.name}
        placeholder={copy.expenses.namePlaceholder}
        value={name}
        error={errors.name}
        onChange={(event) => setName(event.target.value)}
      />
      <Field
        id={`expense-amount-${id}`}
        label={copy.expenses.amount}
        inputMode="decimal"
        value={amount}
        error={errors.amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      {amountChanged && (
        <Field
          id={`expense-from-${id}`}
          label={copy.expenses.fromMonth}
          hint={copy.expenses.fromMonthHint}
          type="month"
          value={fromMonth}
          error={errors.fromMonth}
          onChange={(event) => setFromMonth(event.target.value)}
        />
      )}
      <SelectField
        id={`expense-every-${id}`}
        label={copy.expenses.every}
        value={every}
        hint={oneOff ? copy.expenses.oneOffHint : undefined}
        onChange={(event) =>
          setEvery(
            event.target.value === ONE_OFF
              ? ONE_OFF
              : (Number(event.target.value) as RecurringExpense['everyMonths']),
          )
        }
      >
        {EVERY.map(({ months, label }) => (
          <option key={months} value={months}>
            {label}
          </option>
        ))}
        <option value={ONE_OFF}>{copy.expenses.oneOff}</option>
      </SelectField>
      <Field
        id={`expense-day-${id}`}
        label={copy.expenses.dueDay}
        hint={copy.expenses.dueDayHint}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        value={dueDay}
        error={errors.dueDay}
        onChange={(event) => setDueDay(event.target.value)}
      />
      <Field
        id={`expense-start-${id}`}
        label={oneOff ? copy.expenses.month : copy.expenses.startMonth}
        hint={oneOff ? undefined : copy.expenses.startMonthHint}
        type="month"
        value={startMonth}
        error={errors.startMonth}
        onChange={(event) => setStartMonth(event.target.value)}
      />
      {!oneOff && (
        <Field
          id={`expense-end-${id}`}
          label={copy.expenses.endMonth}
          hint={copy.expenses.endMonthHint}
          type="month"
          value={endMonth}
          error={errors.endMonth}
          onChange={(event) => setEndMonth(event.target.value)}
        />
      )}
      <div className="month-actions">
        <button type="submit" className="action-primary">
          {copy.expenses.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => void onDone(null)}>
          {copy.expenses.cancel}
        </button>
      </div>
    </form>
  );
}
