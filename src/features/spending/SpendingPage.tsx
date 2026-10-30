import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { SelectField } from '../../components/Field';
import { addMonthsTo, monthOf } from '../../domain/month';
import {
  categoryShare,
  spendingMonth,
  SPENDING_CATEGORIES,
  type SpendingItem,
  type SpendingMonth,
} from '../../domain/spending';
import type { RecurringExpense, SpendingCategory, SpendingTransaction } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate, formatMonth } from '../../lib/dates';
import { formatCents, sumCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import '../compare/compare.css';
import '../invoices/invoices.css';
import '../month/month.css';
import { readReceipt, type TransactionDraft } from './receipt';
import { TransactionForm } from './TransactionForm';
import './spending.css';

const copy = t.spending;
const ALL = 'all';

type Tab = 'summary' | 'movements';
type Filter = SpendingCategory | typeof ALL;
type Notice = { text: string; problem?: boolean };

/** "Gastos": what was spent in a month, by category, and each movement. */
export function SpendingPage() {
  const { session } = useSession();
  const [month, setMonth] = useState(monthOf(today()));
  const [tab, setTab] = useState<Tab>('summary');
  const [filter, setFilter] = useState<Filter>(ALL);
  const [editing, setEditing] = useState<TransactionDraft | null>(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [settings, invoices, contracts, providers, expenses, transactions] = await Promise.all([
      getSettings(repos),
      repos.invoices.list(),
      repos.contracts.list(),
      repos.providers.list(),
      repos.expenses.list(),
      repos.transactions.list(),
    ]);
    return { settings, invoices, contracts, providers, expenses, transactions };
  }, [session]);

  if (!session || !data) return null;
  const repos = session.repos;

  if (!data.settings.spendingEnabled) {
    return (
      <>
        <h1>{t.nav.spending}</h1>
        <p>{copy.disabled}</p>
        <Link to="/app/definicoes" className="action-primary">
          {copy.openSettings}
        </Link>
      </>
    );
  }

  const summary = spendingMonth(month, data);
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
        setNotice({ text: copy.receipt.read });
        setEditing(outcome.draft);
      } else if (outcome.kind === 'invoice') {
        setNotice({ text: copy.receipt.invoice, problem: true });
      } else if (outcome.kind === 'known') {
        setNotice({ text: copy.receipt.known, problem: true });
      } else {
        setNotice({ text: copy.receipt.noQr, problem: true });
        setEditing(newDraft());
      }
    } catch {
      setNotice({ text: copy.receipt.noQr, problem: true });
      setEditing(newDraft());
    } finally {
      setReading(false);
    }
  }

  async function save(draft: TransactionDraft | null) {
    if (draft) {
      await repos.transactions.put({
        ...draft,
        createdAt: draft.createdAt ?? new Date().toISOString(),
      });
      // An old receipt is shown where it landed.
      setMonth(monthOf(draft.date));
      setNotice({ text: copy.saved });
    } else {
      setNotice(null);
    }
    setEditing(null);
  }

  const goTo = (next: string) => {
    setEditing(null);
    setNotice(null);
    setMonth(next);
  };

  return (
    <>
      <h1>{t.nav.spending}</h1>
      <p className="muted">{copy.intro}</p>

      <div className="month-nav">
        <button
          type="button"
          className="action-secondary"
          aria-label={t.month.previous}
          title={t.month.previous}
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
          aria-label={t.month.next}
          title={t.month.next}
          onClick={() => goTo(addMonthsTo(month, 1))}
        >
          →
        </button>
      </div>

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

      {reading && <p role="status">{copy.receipt.reading}</p>}
      {notice && (
        <p role="status" className={notice.problem ? 'ingest-problem' : 'doc-saved'}>
          {notice.text}
        </p>
      )}
      {editing && <TransactionForm key={editing.id} initial={editing} onDone={save} />}

      <div className="compare-tabs" role="tablist" aria-label={t.nav.spending}>
        {(['summary', 'movements'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className="compare-tab"
            onClick={() => setTab(item)}
          >
            {copy.tabs[item]}
          </button>
        ))}
      </div>

      {summary.items.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : tab === 'summary' ? (
        <Categories summary={summary} />
      ) : (
        <Movements
          items={summary.items}
          filter={filter}
          onFilter={setFilter}
          nameOf={nameOf}
          transactions={data.transactions}
          expenses={data.expenses}
          onEdit={(transaction) => {
            setNotice(null);
            setEditing(transaction);
          }}
        />
      )}
    </>
  );
}

function Categories({ summary }: { summary: SpendingMonth }) {
  return (
    <section aria-labelledby="spending-categories">
      <h2 id="spending-categories" className="section-title">
        {copy.byCategory}
      </h2>
      <ul className="list">
        {summary.byCategory.map(({ category, totalCents }) => {
          const share = categoryShare(totalCents, summary.byCategory);
          return (
            <li key={category} className="list-item spending-category">
              <strong>{copy.categories[category]}</strong>
              <span className="amount">{formatCents(totalCents)}</span>
              <span className="meta">{share} %</span>
              <span className="spending-bar" aria-hidden="true">
                <span style={{ width: `${share}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Movements({
  items,
  filter,
  onFilter,
  nameOf,
  transactions,
  expenses,
  onEdit,
}: {
  items: SpendingItem[];
  filter: Filter;
  onFilter: (filter: Filter) => void;
  nameOf: (item: SpendingItem) => string;
  transactions: readonly SpendingTransaction[];
  expenses: readonly RecurringExpense[];
  onEdit: (transaction: SpendingTransaction) => void;
}) {
  const shown = items.filter((item) => filter === ALL || item.category === filter);
  return (
    <section aria-label={copy.tabs.movements}>
      <SelectField
        id="spending-filter"
        label={copy.category}
        value={filter}
        onChange={(event) => onFilter(event.target.value as Filter)}
      >
        <option value={ALL}>{copy.allCategories}</option>
        {SPENDING_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {copy.categories[category]}
          </option>
        ))}
      </SelectField>
      <p className="muted">
        {copy.filtered(shown.length, formatCents(sumCents(shown.map((i) => i.amountCents))))}
      </p>
      <ul className="list">
        {shown.map((item) => (
          <Movement
            key={item.id}
            item={item}
            name={nameOf(item)}
            transaction={transactions.find((entry) => entry.id === item.transactionId)}
            expense={expenses.find((entry) => entry.id === item.expenseId)}
            onEdit={onEdit}
          />
        ))}
      </ul>
    </section>
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
