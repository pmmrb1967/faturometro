import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { SelectField } from '../../components/Field';
import { GroupBlock } from '../../components/GroupBlock';
import { incomeMonth } from '../../domain/income';
import { monthOf } from '../../domain/month';
import {
  monthProgress,
  spendingMonth,
  SPENDING_CATEGORIES,
  type SpendingItem,
} from '../../domain/spending';
import type { RecurringExpense, SpendingCategory, SpendingTransaction } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents, sumCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import '../invoices/invoices.css';
import '../month/month.css';
import { IncomeSection } from './IncomeSection';
import { readReceipt, type TransactionDraft } from './receipt';
import { CategoryChart, ProgressChart } from './SpendingCharts';
import { SpendingHelp } from './SpendingHelp';
import { TransactionForm } from './TransactionForm';
import './spending.css';

const copy = t.spending;
const ALL = 'all';

type Filter = SpendingCategory | typeof ALL;
/** Shown only in the month it is about, so it goes away with the arrows. */
type Notice = { text: string; month: string; problem?: boolean };

/** The tab "Gastos" of "Este mês": what was spent, by category and day, and each movement. */
export function SpendingView({
  month,
  onMonth,
}: {
  month: string;
  onMonth: (month: string) => void;
}) {
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>(ALL);
  const [showMovements, setShowMovements] = useState(true);
  const [editing, setEditing] = useState<TransactionDraft | null>(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shownMonth, setShownMonth] = useState(month);
  if (month !== shownMonth) {
    setShownMonth(month);
    setEditing(null);
  }
  const photoInput = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [invoices, contracts, providers, expenses, transactions, incomes] = await Promise.all([
      repos.invoices.list(),
      repos.contracts.list(),
      repos.providers.list(),
      repos.expenses.list(),
      repos.transactions.list(),
      repos.incomes.list(),
    ]);
    return { invoices, contracts, providers, expenses, transactions, incomes };
  }, [session]);

  if (!session || !data) return null;
  const repos = session.repos;

  const summary = spendingMonth(month, data);
  const progress = monthProgress(month, data, today());
  const income = incomeMonth(month, data.incomes);
  const hasIncome = income.items.length > 0;
  const shown = summary.items.filter((item) => filter === ALL || item.category === filter);
  const editingStored = data.transactions.some((entry) => entry.id === editing?.id);

  const nameOf = (item: SpendingItem): string => {
    if (item.kind === 'transaction') {
      const purchase = data.transactions.find((entry) => entry.id === item.transactionId);
      return purchase?.description || copy.categories[item.category];
    }
    if (item.kind === 'expense') {
      return data.expenses.find((entry) => entry.id === item.expenseId)?.name ?? '';
    }
    const invoice = data.invoices.find((entry) => entry.id === item.invoiceId);
    const contract = data.contracts.find((entry) => entry.id === invoice?.contractId);
    const provider = data.providers.find((entry) => entry.id === invoice?.providerId)?.name;
    return [provider, contract?.label].filter(Boolean).join(' — ');
  };

  function newDraft(): TransactionDraft {
    const now = today();
    return {
      id: crypto.randomUUID(),
      date: monthOf(now) === month ? now : `${month}-01`,
      amountCents: 0,
      category: 'food',
      description: '',
      source: 'manual',
    };
  }

  function startNew() {
    setNotice(null);
    setEditing(newDraft());
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;
    setNotice(null);
    setEditing(null);
    setReading(true);
    const problem = (text: string) => setNotice({ text, month, problem: true });
    try {
      const outcome = await readReceipt(new Uint8Array(await photo.arrayBuffer()), photo.type, {
        // pdf.js and zxing are loaded only when a receipt is read.
        readImage: async (bytes, mime) =>
          (await import('../../pdf/browser')).readImage(bytes, mime),
        findInvoiceIdByDocKey: async (docKey) =>
          (await repos.invoices.findBy('docKey', docKey))[0]?.id,
        getTransaction: (id) => repos.transactions.get(id),
        listTransactions: () => repos.transactions.list(),
        issuerName: async (nif) => (await repos.providers.findBy('nif', nif))[0]?.name,
      });
      if (outcome.kind === 'read') {
        setNotice({ text: copy.receipt.read, month });
        setEditing(outcome.draft);
      } else if (outcome.kind === 'invoice') {
        problem(copy.receipt.invoice);
      } else if (outcome.kind === 'known') {
        problem(copy.receipt.known);
      } else {
        problem(copy.receipt.noQr);
        setEditing(newDraft());
      }
    } catch {
      problem(copy.receipt.noQr);
      setEditing(newDraft());
    } finally {
      setReading(false);
    }
  }

  async function save(draft: TransactionDraft | null) {
    setEditing(null);
    if (!draft) {
      setNotice(null);
      return;
    }
    await repos.transactions.put({
      ...draft,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    });
    // An old receipt is shown where it landed.
    setNotice({ text: copy.saved, month: monthOf(draft.date) });
    onMonth(monthOf(draft.date));
  }

  return (
    <>
      {hasIncome ? (
        <dl className="facts">
          <div>
            <dt>{copy.income.spent}</dt>
            <dd>{formatCents(summary.totalCents)}</dd>
          </div>
          <div>
            <dt>{copy.income.received}</dt>
            <dd>{formatCents(income.totalCents)}</dd>
          </div>
          <div>
            <dt>{copy.income.balance}</dt>
            <dd>
              <strong>{formatCents(income.totalCents - summary.totalCents)}</strong>
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="facts">
          <div>
            <dt>{copy.total}</dt>
            <dd>
              <strong>{formatCents(summary.totalCents)}</strong>
            </dd>
          </div>
          <div>
            <dt>{copy.previousMonth}</dt>
            <dd>{formatCents(summary.previousTotalCents)}</dd>
          </div>
          <div>
            <dt>{copy.count}</dt>
            <dd>{summary.items.length}</dd>
          </div>
        </dl>
      )}
      {hasIncome && month === monthOf(today()) && (
        <p className="muted spending-hint">{copy.income.balanceHint}</p>
      )}

      <div className="month-actions">
        <button type="button" className="action-primary" onClick={startNew}>
          {copy.add}
        </button>
        <button
          type="button"
          className="action-secondary"
          disabled={reading}
          onClick={() => photoInput.current?.click()}
        >
          {copy.scan}
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void onPhoto(event)}
        />
      </div>
      <p className="muted spending-hint">{copy.scanHint}</p>
      <SpendingHelp />

      {reading && <p role="status">{copy.receipt.reading}</p>}
      {notice?.month === month && (
        <p role="status" className={notice.problem ? 'ingest-problem' : 'doc-saved'}>
          {notice.text}
        </p>
      )}
      {editing && !editingStored && (
        <TransactionForm key={editing.id} initial={editing} onDone={save} />
      )}

      <IncomeSection month={month} incomes={data.incomes} onMonth={onMonth} />

      {summary.items.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <div className="spending-charts">
          {progress && (
            <ProgressChart
              month={month}
              progress={progress}
              incomeCents={income.totalCents}
              past={month < monthOf(today())}
            />
          )}
          <CategoryChart summary={summary} />
          <GroupBlock
            title={copy.movements}
            summary={copy.filtered(summary.items.length, formatCents(summary.totalCents))}
            open={showMovements}
            onToggle={setShowMovements}
          >
            <SelectField
              id="spending-filter"
              label={copy.category}
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              <option value={ALL}>{copy.allCategories}</option>
              {SPENDING_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {copy.categories[category]}
                </option>
              ))}
            </SelectField>
            {filter !== ALL && (
              <p className="muted">
                {copy.filtered(
                  shown.length,
                  formatCents(sumCents(shown.map((item) => item.amountCents))),
                )}
              </p>
            )}
            <ul className="list">
              {shown.map((item) => {
                const transaction = data.transactions.find(
                  (entry) => entry.id === item.transactionId,
                );
                return transaction && editing?.id === transaction.id ? (
                  <li key={item.id}>
                    <TransactionForm initial={editing} onDone={save} />
                  </li>
                ) : (
                  <Movement
                    key={item.id}
                    item={item}
                    name={nameOf(item)}
                    transaction={transaction}
                    expense={data.expenses.find((entry) => entry.id === item.expenseId)}
                    onEdit={(chosen) => {
                      setNotice(null);
                      setEditing(chosen);
                    }}
                  />
                );
              })}
            </ul>
          </GroupBlock>
        </div>
      )}
    </>
  );
}

function Movement({
  item,
  name,
  transaction,
  expense,
  onEdit,
}: {
  item: SpendingItem;
  name: string;
  transaction?: SpendingTransaction;
  expense?: RecurringExpense;
  onEdit: (transaction: SpendingTransaction) => void;
}) {
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const repos = session.repos;
  const tag =
    item.kind === 'invoice'
      ? copy.invoiceTag
      : item.kind === 'expense'
        ? copy.expenseTag
        : undefined;

  return (
    <li className="list-item spending-movement">
      <strong>{name}</strong>
      <span className="amount">{formatCents(item.amountCents)}</span>
      <span className="meta">
        {[formatIsoDate(item.date), copy.categories[item.category], tag]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {expense && (
        <SelectField
          id={`spending-expense-${item.id}`}
          label={copy.expenseCategory(name)}
          value={item.category}
          onChange={(event) =>
            void repos.expenses.put({
              ...expense,
              category: event.target.value as SpendingCategory,
            })
          }
        >
          {SPENDING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {copy.categories[category]}
            </option>
          ))}
        </SelectField>
      )}
      {transaction && !confirming && (
        <div className="month-actions">
          <button type="button" className="action-secondary" onClick={() => onEdit(transaction)}>
            {copy.edit}
          </button>
          <button
            type="button"
            className="action-secondary danger"
            aria-label={`${copy.remove}: ${name}`}
            onClick={() => setConfirming(true)}
          >
            {copy.remove}
          </button>
        </div>
      )}
      {transaction && confirming && (
        <div className="month-confirm" role="alert">
          <p>{copy.confirmRemove(name)}</p>
          <div className="month-actions">
            <button
              type="button"
              className="action-secondary danger"
              onClick={() => void repos.transactions.remove(transaction.id)}
            >
              {copy.confirm}
            </button>
            <button type="button" className="action-secondary" onClick={() => setConfirming(false)}>
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
