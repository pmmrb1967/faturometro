import { useLiveQuery } from 'dexie-react-hooks';
import { forecastInvoices } from '../../domain/forecast';
import { incomeMonth } from '../../domain/income';
import { countedTransactions, monthSummary } from '../../domain/month';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
// The totals (`.facts`) are styled there.
import '../alerts/alerts.css';

const copy = t.month;

/**
 * The totals of "Este mês", above both tabs: the same numbers in "Despesas"
 * and "Resumo", forecasts included (and said so).
 */
export function MonthTotals({ month }: { month: string }) {
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [invoices, contracts, expenses, payments, transactions, incomes] = await Promise.all([
      repos.invoices.list(),
      repos.contracts.list(),
      repos.expenses.list(),
      repos.payments.list(),
      repos.transactions.list(),
      repos.incomes.list(),
    ]);
    return { invoices, contracts, expenses, payments, transactions, incomes };
  }, [session]);

  if (!data) return null;
  const date = today();
  const summary = monthSummary(
    month,
    data.invoices,
    data.expenses.filter((expense) => !expense.oneOff),
    data.payments,
    {
      today: date,
      contracts: data.contracts,
      forecasts: forecastInvoices(data.contracts, data.invoices, date),
      transactions: countedTransactions(data.transactions, data.invoices),
    },
  );
  const income = incomeMonth(month, data.incomes);
  const hasIncome = income.items.length > 0;

  return (
    <>
      <dl className="facts">
        {hasIncome && (
          <div>
            <dt>{copy.income}</dt>
            <dd>{formatCents(income.totalCents)}</dd>
          </div>
        )}
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
        {hasIncome && (
          <div>
            <dt>{copy.balance}</dt>
            <dd>
              <strong>{formatCents(income.totalCents - summary.totalCents)}</strong>
            </dd>
          </div>
        )}
      </dl>
      {summary.forecastCents !== 0 && (
        <p className="muted">{copy.forecastIncluded(formatCents(summary.forecastCents))}</p>
      )}
    </>
  );
}
