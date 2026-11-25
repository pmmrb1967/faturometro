import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { GroupBlock } from '../../components/GroupBlock';
import { useOpenGroups } from '../../components/group-state';
import { forecastInvoices } from '../../domain/forecast';
import { incomeMonth } from '../../domain/income';
import {
  addMonthsTo,
  countedTransactions,
  expenseActive,
  expenseAmount,
  expenseDueDate,
  groupStatements,
  MONTH_ORDERS,
  monthOf,
  monthSummary,
  sortMonthItems,
  uncheckAction,
  withAmountFrom,
  withTransactionPaid,
  type MonthItem,
  type MonthOrder,
} from '../../domain/month';
import type {
  Payment,
  RecurringExpense,
  CategoryId,
  SpendingTransaction,
  Warranty,
} from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate, formatMonth } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount, sumCents } from '../../lib/money';
import { refreshAlerts, today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { CategorySelect } from '../categories/CategorySelect';
import { categoryName, useCustomCategories } from '../categories/use-categories';
import { AddInvoice } from '../ingest/AddInvoice';
import { ProviderCoverage } from '../ingest/ProviderCoverage';
import { IncomeSection } from '../spending/IncomeSection';
import { SummaryView } from '../spending/SummaryView';
import { TransactionForm } from '../spending/TransactionForm';
import '../compare/compare.css';
import '../insurance/insurance.css';
import '../invoices/invoices.css';
import '../spending/spending.css';
import { EVERY, frequencyOf, MONTH } from './frequency';
import { moveOneOffExpenses } from './one-off-migration';
import { saveOneOff } from './one-off-save';
import { OneOffSection } from './OneOffSection';
import './month.css';
import { KindTag } from './KindTag';
import { lineKind } from './line-kind';
import { MonthTotals } from './MonthTotals';
import { useRememberedOrder } from './use-remembered-order';

type Tab = 'expenses' | 'summary';

/** Per-device choice: the tab "Este mês" opens on. */
const TAB_KEY = 'faturometro.month.tab';
/** Per-device choice: which blocks of "Despesas" are open (only the list, at first). */
const OPEN_GROUPS_KEY = 'faturometro.month.openGroups';
const LIST = 'list';
const copy = t.month;

type SavedExpense = Omit<RecurringExpense, 'updatedAt'>;

const FILTERS = ['all', 'invoice', 'expense', 'transaction'] as const;
type Filter = (typeof FILTERS)[number];

/** A link can ask for a tab (alerts open "Despesas"); otherwise, the last one on this device. */
function firstTab(): Tab {
  const asked = new URLSearchParams(window.location.search).get('separador');
  // "gastos" and "pagamentos": links from before the tabs were renamed.
  if (asked === 'resumo' || asked === 'gastos') return 'summary';
  if (asked === 'despesas' || asked === 'pagamentos') return 'expenses';
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return stored === 'summary' || stored === 'spending' ? 'summary' : 'expenses';
  } catch {
    return 'expenses';
  }
}

/**
 * "Este mês": everything the household pays in a month (invoices, recurring
 * expenses without one, purchases and one-off expenses), marked as paid or
 * not, and, with purchases turned on, a summary of where the money went.
 */
export function MonthPage() {
  const { session } = useSession();
  const [month, setMonth] = useState(monthOf(today()));
  const [tab, setTab] = useState<Tab>(firstTab);
  if (!session) return null;

  function choose(next: Tab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered on this device; the choice still applies now.
    }
  }

  return (
    <>
      <h1>{t.nav.month}</h1>
      <div className="compare-tabs" role="tablist" aria-label={t.nav.month}>
        {(['expenses', 'summary'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className="compare-tab"
            onClick={() => choose(item)}
          >
            {copy.tabs[item]}
          </button>
        ))}
      </div>
      <p className="muted">{tab === 'summary' ? t.spending.intro : copy.intro}</p>

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

      <MonthTotals month={month} />

      {tab === 'summary' ? (
        <SummaryView month={month} />
      ) : (
        <ExpensesView month={month} onMonth={setMonth} />
      )}
    </>
  );
}

function matches(item: MonthItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'invoice') return item.kind === 'invoice' || item.kind === 'forecast';
  return item.kind === filter;
}

/**
 * The tab "Despesas": the month's totals, every expense of the month (open at
 * first), then the blocks to add income, invoices, recurring expenses without
 * an invoice and one-off expenses.
 */
function ExpensesView({ month, onMonth }: { month: string; onMonth: (month: string) => void }) {
  const { session } = useSession();
  // Expense being changed, in its line of the month or in the expenses block.
  const [editing, setEditing] = useState<{ id: string; place: 'line' | 'section' } | null>(null);
  const groups = useOpenGroups(OPEN_GROUPS_KEY, (group) => group === LIST);
  const [order, setOrder] = useRememberedOrder('faturometro.month.order', MONTH_ORDERS);
  const [filter, setFilter] = useState<Filter>('all');
  /** Statements (Via Verde) showing their invoices. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [shownMonth, setShownMonth] = useState(month);
  if (month !== shownMonth) {
    setShownMonth(month);
    setEditing(null);
  }
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [
      invoices,
      contracts,
      providers,
      expenses,
      payments,
      transactions,
      incomes,
      warranties,
      categories,
    ] = await Promise.all([
      repos.invoices.list(),
      repos.contracts.list(),
      repos.providers.list(),
      repos.expenses.list(),
      repos.payments.list(),
      repos.transactions.list(),
      repos.incomes.list(),
      repos.warranties.list(),
      repos.categories.list(),
    ]);
    return {
      invoices: new Map(invoices.map((invoice) => [invoice.id, invoice])),
      contracts: new Map(contracts.map((contract) => [contract.id, contract])),
      providers: new Map(providers.map((provider) => [provider.id, provider])),
      expenses,
      payments,
      transactions: countedTransactions(transactions, invoices),
      incomes,
      categories,
      warrantyByTransaction: new Map(
        warranties.flatMap((warranty) =>
          warranty.transactionId ? [[warranty.transactionId, warranty] as const] : [],
        ),
      ),
    };
  }, [session]);

  // One-off expenses synced from a device with an older version: moved to the purchases here too.
  const legacyOneOff = data?.expenses.some((expense) => expense.oneOff) ?? false;
  useEffect(() => {
    if (session && legacyOneOff) void moveOneOffExpenses(session.repos).catch(() => undefined);
  }, [session, legacyOneOff]);

  if (!session || !data) return null;
  const repos = session.repos;
  const date = today();
  const invoices = [...data.invoices.values()];
  const contracts = [...data.contracts.values()];
  const recurring = data.expenses.filter((expense) => !expense.oneOff);
  const summary = monthSummary(month, invoices, recurring, data.payments, {
    today: date,
    contracts,
    forecasts: forecastInvoices(contracts, invoices, date),
    transactions: data.transactions,
  });
  const income = incomeMonth(month, data.incomes);
  // Recurring expenses between their first and last month (due this month or not).
  const active = recurring
    .filter((expense) => expenseActive(expense, month))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const oneOffs = data.transactions.filter((transaction) => monthOf(transaction.date) === month);
  const lines = sortMonthItems(groupStatements(summary.items, invoices, contracts), order);
  const shown = lines.filter((item) => matches(item, filter));

  const transactionName = (transaction: SpendingTransaction) =>
    transaction.description || categoryName(transaction.category, data.categories);

  const nameOf = (item: MonthItem): string => {
    if (item.parts) {
      return copy.statement(data.contracts.get(item.contractId ?? '')?.label ?? '');
    }
    if (item.kind === 'expense') {
      return data.expenses.find((expense) => expense.id === item.expenseId)?.name ?? '';
    }
    if (item.kind === 'transaction') {
      const transaction = data.transactions.find((entry) => entry.id === item.transactionId);
      return transaction ? transactionName(transaction) : '';
    }
    const invoice = data.invoices.get(item.invoiceId ?? '');
    const contract = data.contracts.get(invoice?.contractId ?? item.contractId ?? '');
    const provider = data.providers.get(invoice?.providerId ?? contract?.providerId ?? '')?.name;
    return [provider, contract?.label].filter(Boolean).join(' — ');
  };

  /** Issuer of one invoice of a statement (Brisa, Infraestruturas de Portugal…). */
  const issuerOf = (item: MonthItem): string =>
    data.providers.get(data.invoices.get(item.invoiceId ?? '')?.providerId ?? '')?.name ?? '';

  async function markPaid(item: MonthItem, paid: boolean) {
    if (item.kind === 'transaction') {
      const transaction = data?.transactions.find((entry) => entry.id === item.transactionId);
      if (transaction) await repos.transactions.put(withTransactionPaid(transaction, paid, date));
      return;
    }
    const target = {
      id: item.paymentId,
      ...(item.invoiceId ? { invoiceId: item.invoiceId } : {}),
      ...(item.expenseId ? { expenseId: item.expenseId, month } : {}),
    };
    if (paid) {
      // A receipt (Via Verde) unticked and ticked again: paid when issued, not today.
      const invoice = data?.invoices.get(item.invoiceId ?? '');
      const receipt =
        invoice && data?.contracts.get(invoice.contractId)?.usageBased
          ? invoice.issueDate
          : undefined;
      const payment: Omit<Payment, 'updatedAt'> = { ...target, paidOn: receipt ?? date };
      await repos.payments.put(payment);
    } else if (uncheckAction(item) === 'unpaid') {
      // The direct debit failed (or the receipt was not paid): say so, or the app marks it again.
      const payment: Omit<Payment, 'updatedAt'> = { ...target, unpaid: true };
      await repos.payments.put(payment);
    } else {
      await repos.payments.remove(item.paymentId);
    }
  }

  /** A statement marks each of its invoices. */
  async function setPaid(item: MonthItem, paid: boolean) {
    for (const part of item.parts ?? [item]) {
      // Ticking a statement leaves alone the invoices already paid.
      if (paid && part.paidOn) continue;
      if (!paid && !part.paidOn) continue;
      await markPaid(part, paid);
    }
    // The prescription and payment alerts depend on it.
    await refreshAlerts(repos);
  }

  function toggleOpen(key: string) {
    setOpened((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  async function saveExpense(expense: SavedExpense | null) {
    if (expense) await repos.expenses.put(expense);
    setEditing(null);
  }

  return (
    <>
      <GroupBlock
        title={copy.list.title}
        summary={copy.list.summary(lines.length, formatCents(summary.totalCents))}
        open={groups.isOpen(LIST)}
        onToggle={(open) => groups.setOpen(LIST, open)}
      >
        {summary.items.length === 0 ? (
          <p className="muted">{copy.empty}</p>
        ) : (
          <>
            {summary.items.length > 1 && (
              <div className="spending-controls">
                <SelectField
                  id="month-filter"
                  label={copy.list.filter}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as Filter)}
                >
                  {FILTERS.map((item) => (
                    <option key={item} value={item}>
                      {copy.list.filters[item]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="month-order"
                  label={copy.order.label}
                  value={order}
                  onChange={(event) => setOrder(event.target.value as MonthOrder)}
                >
                  {MONTH_ORDERS.map((item) => (
                    <option key={item} value={item}>
                      {copy.order[item]}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            {filter !== 'all' && (
              <p className="muted">
                {shown.length === 0
                  ? copy.list.emptyFilter
                  : copy.list.summary(
                      shown.length,
                      formatCents(sumCents(shown.map((item) => item.amountCents))),
                    )}
              </p>
            )}
            <ul className="list">
              {shown.map((item) => {
                const name = nameOf(item);
                if (item.kind === 'forecast') {
                  return (
                    <li
                      key={item.paymentId}
                      className="list-item month-item is-forecast kind-forecast"
                    >
                      <span className="month-check" aria-hidden="true" />
                      <strong>{name}</strong>
                      <span className="amount">
                        {copy.forecastAmount(formatCents(item.amountCents))}
                      </span>
                      <span className="meta">
                        {item.debitDate
                          ? copy.forecastDebit(formatIsoDate(item.date))
                          : item.hasDueDate
                            ? copy.forecastDue(formatIsoDate(item.date))
                            : copy.forecastIssued(formatIsoDate(item.date))}
                        {item.late && ` · ${copy.forecastLate}`}
                      </span>
                      <KindTag kind="forecast" />
                    </li>
                  );
                }
                const transaction =
                  item.kind === 'transaction'
                    ? data.transactions.find((entry) => entry.id === item.transactionId)
                    : undefined;
                if (transaction) {
                  return (
                    <TransactionLine
                      key={item.paymentId}
                      item={item}
                      name={name}
                      transaction={transaction}
                      warranty={data.warrantyByTransaction.get(transaction.id)}
                      onPaid={(paid) => void setPaid(item, paid)}
                      onMonth={onMonth}
                    />
                  );
                }
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
                    className={`list-item month-item kind-${lineKind(item)}${item.paidOn ? ' is-paid' : ''}`}
                  >
                    <PaidCheck
                      item={item}
                      name={name}
                      onPaid={(paid) => void setPaid(item, paid)}
                    />
                    <strong>{name}</strong>
                    <span className="amount">{formatCents(item.amountCents)}</span>
                    <span className="meta">
                      {item.debitDate
                        ? copy.debit(formatIsoDate(item.debitDate))
                        : item.hasDueDate
                          ? copy.due(formatIsoDate(item.date))
                          : item.autoPaid
                            ? copy.issuedOn(formatIsoDate(item.date))
                            : copy.issued(formatIsoDate(item.date))}
                      {item.paidOn &&
                        ` · ${
                          item.autoPaid && item.debitDate
                            ? copy.autoPaid
                            : item.autoPaid
                              ? copy.receiptPaid(formatIsoDate(item.paidOn))
                              : copy.paidOn(formatIsoDate(item.paidOn))
                        }`}
                    </span>
                    <KindTag kind={lineKind(item)} />
                    {item.parts && (
                      <div className="month-parts">
                        <button
                          type="button"
                          className="action-secondary action-compact"
                          aria-expanded={opened.has(item.paymentId)}
                          onClick={() => toggleOpen(item.paymentId)}
                        >
                          {opened.has(item.paymentId)
                            ? copy.statementHide
                            : copy.statementShow(item.parts.length)}
                        </button>
                        {opened.has(item.paymentId) && (
                          <ul>
                            {item.parts.map((part) => (
                              <li key={part.paymentId}>
                                <span>{issuerOf(part)}</span>
                                <span className="amount">{formatCents(part.amountCents)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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
          </>
        )}
      </GroupBlock>

      <GroupBlock
        title={t.spending.income.title}
        summary={
          income.items.length === 0
            ? t.spending.income.emptyMonth
            : t.spending.income.listSummary(income.items.length, formatCents(income.totalCents))
        }
        open={groups.isOpen('income')}
        onToggle={(open) => groups.setOpen('income', open)}
      >
        <IncomeSection month={month} incomes={data.incomes} onMonth={onMonth} flat />
      </GroupBlock>

      <GroupBlock
        title={copy.addInvoice.title}
        summary={copy.addInvoice.summary}
        open={groups.isOpen('invoice')}
        onToggle={(open) => groups.setOpen('invoice', open)}
      >
        <AddInvoice />
        <ProviderCoverage />
      </GroupBlock>

      <GroupBlock
        title={copy.expenses.title}
        summary={
          active.length === 0
            ? copy.expenses.emptyMonth
            : copy.expenses.listSummary(
                active.length,
                formatCents(
                  active.reduce((sum, expense) => sum + expenseAmount(expense, month), 0),
                ),
              )
        }
        open={groups.isOpen('expenses')}
        onToggle={(open) => groups.setOpen('expenses', open)}
      >
        <p className="muted">{copy.expenses.intro}</p>
        {active.length === 0 && (
          <p className="muted">
            {recurring.length === 0 ? copy.expenses.empty : copy.expenses.emptyMonth}
          </p>
        )}
        {active.length > 0 && (
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
                    {expense.endMonth
                      ? copy.expenses.between(
                          formatMonth(expense.startMonth),
                          formatMonth(expense.endMonth),
                        )
                      : copy.expenses.since(formatMonth(expense.startMonth))}
                  </span>
                  <ExpenseActions
                    expense={expense}
                    stopFrom={month}
                    onEdit={() => setEditing({ id: expense.id, place: 'section' })}
                  />
                </li>
              ),
            )}
          </ul>
        )}
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
      </GroupBlock>

      <GroupBlock
        title={copy.oneOff.title}
        summary={copy.oneOff.summary(
          oneOffs.length,
          formatCents(sumCents(oneOffs.map((transaction) => transaction.amountCents))),
        )}
        open={groups.isOpen('oneOff')}
        onToggle={(open) => groups.setOpen('oneOff', open)}
      >
        <OneOffSection month={month} onMonth={onMonth} />
      </GroupBlock>
    </>
  );
}

function PaidCheck({
  item,
  name,
  onPaid,
}: {
  item: MonthItem;
  name: string;
  onPaid: (paid: boolean) => void;
}) {
  return (
    <label className="month-check">
      <input
        type="checkbox"
        checked={item.paidOn !== undefined}
        aria-label={copy.paidLabel(name)}
        onChange={(event) => onPaid(event.target.checked)}
      />
      <span aria-hidden="true">{copy.paidCheck}</span>
    </label>
  );
}

/** A purchase or one-off expense in the month's list: ticked, changed or deleted there. */
function TransactionLine({
  item,
  name,
  transaction,
  warranty,
  onPaid,
  onMonth,
}: {
  item: MonthItem;
  name: string;
  transaction: SpendingTransaction;
  warranty?: Warranty;
  onPaid: (paid: boolean) => void;
  onMonth: (month: string) => void;
}) {
  const { session } = useSession();
  const custom = useCustomCategories() ?? [];
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const repos = session.repos;
  const oneOff = transaction.toPay === true || transaction.paidOn !== undefined;

  if (editing) {
    return (
      <li>
        <TransactionForm
          initial={transaction}
          warranty={warranty}
          onDone={async (draft, choice) => {
            if (draft) {
              await saveOneOff(repos, draft, choice, warranty);
              if (monthOf(draft.date) !== monthOf(transaction.date)) onMonth(monthOf(draft.date));
            }
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`list-item month-item kind-oneOff${item.paidOn ? ' is-paid' : ''}`}>
      <PaidCheck item={item} name={name} onPaid={onPaid} />
      <strong>{name}</strong>
      <span className="amount">{formatCents(item.amountCents)}</span>
      <span className="meta">
        {[
          oneOff
            ? copy.due(formatIsoDate(transaction.date))
            : copy.oneOff.spentOn(formatIsoDate(transaction.date)),
          oneOff && item.paidOn ? copy.paidOn(formatIsoDate(item.paidOn)) : undefined,
          categoryName(transaction.category, custom),
          warranty ? copy.oneOff.warrantyTag : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <KindTag kind="oneOff" label={oneOff ? copy.oneOff.oneOffTag : copy.oneOff.purchaseTag} />
      {confirming ? (
        <div className="month-confirm" role="alert">
          <p>{copy.oneOff.confirmRemove(name)}</p>
          <div className="month-actions">
            <button
              type="button"
              className="action-secondary danger"
              onClick={() => void repos.transactions.remove(transaction.id)}
            >
              {copy.expenses.confirm}
            </button>
            <button type="button" className="action-secondary" onClick={() => setConfirming(false)}>
              {copy.expenses.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="month-actions">
          <button type="button" className="action-secondary" onClick={() => setEditing(true)}>
            {copy.expenses.edit}
          </button>
          <button
            type="button"
            className="action-secondary danger"
            aria-label={`${copy.expenses.remove}: ${name}`}
            onClick={() => setConfirming(true)}
          >
            {copy.expenses.remove}
          </button>
        </div>
      )}
    </li>
  );
}

/** Change, stop or delete a recurring expense; deleting asks first. */
function ExpenseActions({
  expense,
  stopFrom,
  onEdit,
}: {
  expense: RecurringExpense;
  /** Month from which "Já não pago" stops it (only in the expenses block). */
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

/** A recurring expense without an invoice (one-off ones are in "Gastos e despesas pontuais"). */
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
  const [every, setEvery] = useState<RecurringExpense['everyMonths']>(initial?.everyMonths ?? 1);
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 1));
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? month);
  const [endMonth, setEndMonth] = useState(initial?.endMonth ?? '');
  const [category, setCategory] = useState<CategoryId>(initial?.category ?? 'other');
  const [paidBefore, setPaidBefore] = useState(!initial);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof copy.expenses.errors, string>>>(
    {},
  );
  const id = initial?.id ?? 'new';
  const amountCents = parsePtAmount(amount);
  const date = today();
  // Starts in the past: on a new expense, those months were most likely paid; on a
  // stored one, the user may tick them all at once, and nothing changes unless they do.
  const firstDue =
    MONTH.test(startMonth) && Number.isInteger(Number(dueDay))
      ? expenseDueDate({ startMonth, everyMonths: 1, dueDay: Number(dueDay) }, startMonth)
      : null;
  const startsInThePast = firstDue !== null && firstDue < date;
  // A new amount on an existing expense: from which month (earlier ones keep theirs).
  const amountChanged =
    shownAmount !== undefined && amountCents !== null && amountCents !== shownAmount;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const day = Number(dueDay);
    const found: typeof errors = {};
    if (!name.trim()) found.name = copy.expenses.errors.name;
    if (amountCents === null || amountCents <= 0) found.amount = copy.expenses.errors.amount;
    if (!Number.isInteger(day) || day < 1 || day > 31) found.dueDay = copy.expenses.errors.dueDay;
    if (!MONTH.test(startMonth)) found.startMonth = copy.expenses.errors.startMonth;
    if (endMonth && (!MONTH.test(endMonth) || endMonth < startMonth)) {
      found.endMonth = copy.expenses.errors.endMonth;
    }
    if (amountChanged && (!MONTH.test(fromMonth) || fromMonth < startMonth)) {
      found.fromMonth = copy.expenses.errors.fromMonth;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    const expense: SavedExpense = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      amountCents: initial ? initial.amountCents : amountCents,
      ...(initial?.amountChanges ? { amountChanges: initial.amountChanges } : {}),
      everyMonths: every,
      dueDay: day,
      startMonth,
      ...(endMonth ? { endMonth } : {}),
      category,
      ...(initial?.paidUntil ? { paidUntil: initial.paidUntil } : {}),
      ...(startsInThePast && paidBefore ? { paidUntil: date } : {}),
      createdAt: initial?.createdAt ?? new Date().toISOString(),
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
        onChange={(event) =>
          setEvery(Number(event.target.value) as RecurringExpense['everyMonths'])
        }
      >
        {EVERY.map(({ months, label }) => (
          <option key={months} value={months}>
            {label}
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
      <Field
        id={`expense-end-${id}`}
        label={copy.expenses.endMonth}
        hint={copy.expenses.endMonthHint}
        type="month"
        value={endMonth}
        error={errors.endMonth}
        onChange={(event) => setEndMonth(event.target.value)}
      />
      <CategorySelect
        id={`expense-category-${id}`}
        label={copy.expenses.category}
        value={category}
        onChange={(next) => setCategory(next ?? 'other')}
      />
      {startsInThePast && (
        <label className="month-paid-before">
          <input
            type="checkbox"
            checked={paidBefore}
            onChange={(event) => setPaidBefore(event.target.checked)}
          />
          {copy.expenses.alreadyPaidMonths}
        </label>
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
