import { useLiveQuery } from 'dexie-react-hooks';
import { InfoTip } from '../../components/InfoTip';
import { forecastInvoices } from '../../domain/forecast';
import { incomeMonth } from '../../domain/income';
import { monthOf } from '../../domain/month';
import { forecastStillDue, monthProgress, spendingMonth } from '../../domain/spending';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { CategoryChart } from './SpendingCharts';
import { SpendingTimeline } from './SpendingTimeline';
import './spending.css';
// The totals (`.facts`) are styled there.
import '../alerts/alerts.css';

const copy = t.spending;

/**
 * The tab "Resumo" of "Este mês": where the money of the month went, along
 * the month and the year and by category. Each expense is in "Despesas".
 */
export function SummaryView({ month }: { month: string }) {
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [invoices, contracts, expenses, transactions, incomes] = await Promise.all([
      repos.invoices.list(),
      repos.contracts.list(),
      repos.expenses.list(),
      repos.transactions.list(),
      repos.incomes.list(),
    ]);
    return { invoices, contracts, expenses, transactions, incomes };
  }, [session]);

  if (!session || !data) return null;

  const summary = spendingMonth(month, data);
  // The forecasts of "Despesas", left out here: they are estimates.
  const stillDue = forecastStillDue(
    month,
    summary.totalCents,
    forecastInvoices(data.contracts, data.invoices, today()),
  );
  const forecastTip = stillDue && (
    <InfoTip label={copy.forecastTipLabel}>
      {copy.forecastTip(formatCents(stillDue.forecastCents), formatCents(stillDue.expectedCents))}
    </InfoTip>
  );
  const progress = monthProgress(month, data, today());
  const income = incomeMonth(month, data.incomes);
  const hasIncome = income.items.length > 0;

  return (
    <>
      {hasIncome ? (
        <dl className="facts">
          <div>
            <dt>
              {copy.income.spent}
              {forecastTip}
            </dt>
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
            <dt>
              {copy.total}
              {forecastTip}
            </dt>
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

      {summary.items.length === 0 && <p className="muted">{copy.empty}</p>}
      <div className="spending-charts">
        <SpendingTimeline
          month={month}
          // An empty month draws nothing of its own, but its year still has a story.
          progress={summary.items.length === 0 ? null : progress}
          data={data}
          incomes={data.incomes}
          incomeCents={income.totalCents}
        />
        {summary.items.length > 0 && <CategoryChart summary={summary} />}
      </div>
    </>
  );
}
