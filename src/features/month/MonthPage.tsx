import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import type { BillingFrequency } from '../../domain/grouping';
import { addMonthsTo, monthOf, monthSummary, type MonthItem } from '../../domain/month';
import type { Payment, RecurringExpense } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount } from '../../lib/money';
import { refreshAlerts, today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import '../invoices/invoices.css';
import './month.css';

const copy = t.month;
const EVERY: { months: RecurringExpense['everyMonths']; frequency: BillingFrequency }[] = [
  { months: 1, frequency: 'monthly' },
  { months: 2, frequency: 'bimonthly' },
  { months: 3, frequency: 'quarterly' },
  { months: 6, frequency: 'semiannual' },
  { months: 12, frequency: 'annual' },
];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthName = new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatMonth(month: string): string {
  return monthName.format(new Date(`${month}-01T00:00:00Z`));
}

function frequencyOf(months: RecurringExpense['everyMonths']): string {
  return t.frequency[EVERY.find((every) => every.months === months)?.frequency ?? 'monthly'];
}

/** "Este mês": what is due in a month, marked as paid or not, and expenses without an invoice. */
export function MonthPage() {
  const { session } = useSession();
  const [month, setMonth] = useState(monthOf(today()));
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
  const summary = monthSummary(month, [...data.invoices.values()], data.expenses, data.payments);

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
    if (!session) return;
    if (paid) {
      const payment: Omit<Payment, 'updatedAt'> = {
        id: item.paymentId,
        paidOn: today(),
        ...(item.invoiceId ? { invoiceId: item.invoiceId } : {}),
        ...(item.expenseId ? { expenseId: item.expenseId, month } : {}),
      };
      await session.repos.payments.put(payment);
    } else {
      await session.repos.payments.remove(item.paymentId);
    }
    // The prescription and payment alerts depend on it.
    await refreshAlerts(session.repos);
  }

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
          onClick={() => setMonth(addMonthsTo(month, -1))}
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
          onClick={() => setMonth(addMonthsTo(month, 1))}
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
                  {item.hasDueDate
                    ? copy.due(formatIsoDate(item.date))
                    : copy.issued(formatIsoDate(item.date))}
                  {item.paidOn && ` · ${copy.paidOn(formatIsoDate(item.paidOn))}`}
                  {item.kind === 'expense' && ` · ${copy.expenseTag}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ExpensesSection month={month} expenses={data.expenses} />
    </>
  );
}

function ExpensesSection({
  month,
  expenses,
}: {
  month: string;
  expenses: readonly RecurringExpense[];
}) {
  const { session } = useSession();
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  // Expenses that ended before this month are not shown.
  const shown = expenses
    .filter((expense) => !expense.endMonth || expense.endMonth >= month)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  if (!session) return null;
  const repos = session.repos;

  async function stop(expense: RecurringExpense) {
    const endMonth = addMonthsTo(month, -1);
    if (endMonth < expense.startMonth) await repos.expenses.remove(expense.id);
    else await repos.expenses.put({ ...expense, endMonth });
  }

  return (
    <section aria-labelledby="expenses-title">
      <h2 id="expenses-title" className="section-title">
        {copy.expenses.title}
      </h2>
      <p className="muted">{copy.expenses.intro}</p>
      {shown.length === 0 && <p className="muted">{copy.expenses.empty}</p>}
      <ul className="list">
        {shown.map((expense) =>
          editing !== 'new' && editing?.id === expense.id ? (
            <li key={expense.id}>
              <ExpenseForm
                initial={expense}
                month={month}
                onDone={async (saved) => {
                  if (saved) await repos.expenses.put(saved);
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={expense.id} className="list-item month-expense">
              <strong>{expense.name}</strong>
              <span className="meta">
                {copy.expenses.summary(
                  formatCents(expense.amountCents),
                  frequencyOf(expense.everyMonths),
                  expense.dueDay,
                )}
              </span>
              <div className="month-actions">
                <button
                  type="button"
                  className="action-secondary"
                  onClick={() => setEditing(expense)}
                >
                  {copy.expenses.edit}
                </button>
                <button
                  type="button"
                  className="action-secondary"
                  aria-label={copy.expenses.stopLabel(expense.name, formatMonth(month))}
                  onClick={() => void stop(expense)}
                >
                  {copy.expenses.stop}
                </button>
                <button
                  type="button"
                  className="action-secondary danger"
                  onClick={() => void repos.expenses.remove(expense.id)}
                >
                  {copy.expenses.remove}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <ExpenseForm
          month={month}
          onDone={async (saved) => {
            if (saved) await repos.expenses.put(saved);
            setEditing(null);
          }}
        />
      ) : (
        <p>
          <button type="button" className="action-primary" onClick={() => setEditing('new')}>
            {copy.expenses.add}
          </button>
        </p>
      )}
    </section>
  );
}

function ExpenseForm({
  initial,
  month,
  onDone,
}: {
  initial?: RecurringExpense;
  month: string;
  onDone: (expense: Omit<RecurringExpense, 'updatedAt'> | null) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? centsToPtInput(initial.amountCents) : '');
  const [every, setEvery] = useState<RecurringExpense['everyMonths']>(initial?.everyMonths ?? 1);
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 1));
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? month);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof copy.expenses.errors, string>>>(
    {},
  );
  const id = initial?.id ?? 'new';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parsePtAmount(amount);
    const day = Number(dueDay);
    const found: typeof errors = {};
    if (!name.trim()) found.name = copy.expenses.errors.name;
    if (amountCents === null || amountCents <= 0) found.amount = copy.expenses.errors.amount;
    if (!Number.isInteger(day) || day < 1 || day > 31) found.dueDay = copy.expenses.errors.dueDay;
    if (!MONTH.test(startMonth)) found.startMonth = copy.expenses.errors.startMonth;
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    const { endMonth, ...kept } = initial ?? { endMonth: undefined };
    await onDone({
      ...kept,
      ...(endMonth && endMonth >= startMonth ? { endMonth } : {}),
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      amountCents,
      everyMonths: every,
      dueDay: day,
      startMonth,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
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
      <SelectField
        id={`expense-every-${id}`}
        label={copy.expenses.every}
        value={every}
        onChange={(event) =>
          setEvery(Number(event.target.value) as RecurringExpense['everyMonths'])
        }
      >
        {EVERY.map(({ months, frequency }) => (
          <option key={months} value={months}>
            {t.frequency[frequency]}
          </option>
        ))}
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
        label={copy.expenses.startMonth}
        hint={copy.expenses.startMonthHint}
        type="month"
        value={startMonth}
        error={errors.startMonth}
        onChange={(event) => setStartMonth(event.target.value)}
      />
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
