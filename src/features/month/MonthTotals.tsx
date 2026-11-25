import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
// The totals (`.facts`) are styled there.
import '../alerts/alerts.css';
import { useMonthTotals } from './use-month-totals';

const copy = t.month;

/**
 * The totals of "Este mês", above both tabs: the same numbers in "Despesas"
 * and "Resumo", forecasts included (and said so).
 */
export function MonthTotals({ month }: { month: string }) {
  const totals = useMonthTotals(month);
  if (!totals) return null;
  const { summary, income } = totals;
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
