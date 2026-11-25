import { useLiveQuery } from 'dexie-react-hooks';
import { incomeMonth } from '../../domain/income';
import { monthOf } from '../../domain/month';
import { monthProgress, spendingMonth, type SpendingItem } from '../../domain/spending';
import type { CategoryId } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { categoryName } from '../categories/use-categories';
import { useMonthTotals } from '../month/use-month-totals';
import { CategoryChart } from './SpendingCharts';
import { SpendingTimeline } from './SpendingTimeline';
import './spending.css';

const copy = t.spending;

/**
 * The tab "Resumo" of "Este mês": where the money of the month went, along
 * the month and the year and by category. The totals are above the tabs, the
 * same as in "Despesas"; the charts count only real amounts, no forecasts.
 */
export function SummaryView({ month }: { month: string }) {
  const { session } = useSession();
  const totals = useMonthTotals(month);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [invoices, contracts, expenses, transactions, incomes, providers, categories] =
      await Promise.all([
        repos.invoices.list(),
        repos.contracts.list(),
        repos.expenses.list(),
        repos.transactions.list(),
        repos.incomes.list(),
        repos.providers.list(),
        repos.categories.list(),
      ]);
    return { invoices, contracts, expenses, transactions, incomes, providers, categories };
  }, [session]);

  if (!session || !data) return null;

  const summary = spendingMonth(month, data);
  // The month's total with what is still to come, as above the tabs.
  const monthTotalCents = totals?.summary.totalCents;
  const progress = monthProgress(month, data, today());
  const income = incomeMonth(month, data.incomes);
  const label = (category: CategoryId) => categoryName(category, data.categories);
  const itemName = (item: SpendingItem): string => {
    if (item.kind === 'expense') {
      return data.expenses.find((expense) => expense.id === item.expenseId)?.name ?? '';
    }
    if (item.kind === 'transaction') {
      const transaction = data.transactions.find((entry) => entry.id === item.transactionId);
      return transaction?.description || label(item.category);
    }
    const invoice = data.invoices.find((entry) => entry.id === item.invoiceId);
    const contract = data.contracts.find((entry) => entry.id === invoice?.contractId);
    const provider = data.providers.find((entry) => entry.id === invoice?.providerId)?.name;
    return [provider, contract?.label].filter(Boolean).join(' — ');
  };

  return (
    <>
      <p className="muted spending-hint">
        {copy.chartsHint}
        {income.items.length > 0 && month === monthOf(today()) && ` ${copy.income.balanceHint}`}
      </p>
      {summary.items.length === 0 && <p className="muted">{copy.empty}</p>}
      <div className="spending-charts">
        <SpendingTimeline
          month={month}
          // An empty month draws nothing of its own, but its year still has a story.
          progress={summary.items.length === 0 ? null : progress}
          data={data}
          incomes={data.incomes}
          incomeCents={income.totalCents}
          {...(monthTotalCents !== undefined ? { monthTotalCents } : {})}
        />
        {summary.items.length > 0 && (
          <CategoryChart summary={summary} categoryLabel={label} itemName={itemName} />
        )}
      </div>
    </>
  );
}
