import { useMemo } from 'react';
import { monthOf } from '../../domain/month';
import { yearProgress, type MonthProgress, type SpendingData } from '../../domain/spending';
import type { Income } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import type { Cents } from '../../lib/money';
import { today } from '../alerts/refresh';
import '../compare/compare.css';
import { useRememberedOrder } from '../month/use-remembered-order';
import { ProgressChart } from './SpendingCharts';
import { YearChart } from './SpendingYearChart';

const copy = t.spending.year;
const VIEWS = ['month', 'year'] as const;

/**
 * The chart over time, of the month or of the year. A month with no chart of its own, one
 * to come or with nothing spent, shows its year, with no choice to make.
 */
export function SpendingTimeline({
  month,
  progress,
  data,
  incomes,
  incomeCents,
}: {
  month: string;
  progress: MonthProgress | null;
  data: SpendingData;
  incomes: readonly Income[];
  incomeCents: Cents;
}) {
  const [view, setView] = useRememberedOrder('faturometro.spending.chart', VIEWS);
  const year = month.slice(0, 4);
  const yearly = useMemo(() => yearProgress(year, data, incomes, today()), [year, data, incomes]);

  const switcher =
    progress && yearly ? (
      <div className="compare-tabs spending-views" role="tablist" aria-label={copy.viewsLabel}>
        {VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={view === item}
            className="compare-tab"
            onClick={() => setView(item)}
          >
            {copy.views[item]}
          </button>
        ))}
      </div>
    ) : null;

  if (yearly && (!progress || view === 'year')) {
    return <YearChart progress={yearly} switcher={switcher} />;
  }
  if (!progress) return null;
  return (
    <ProgressChart
      month={month}
      progress={progress}
      incomeCents={incomeCents}
      past={month < monthOf(today())}
      switcher={switcher}
    />
  );
}
