import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { BarChart, type Bar, type Series } from '../../components/BarChart';
import type { Sector } from '../../domain/types';
import { expensesYear, householdSummary } from '../../domain/household';
import { t } from '../../i18n/pt-PT';
import { formatMonthShort } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { totalSwitchSavings } from '../contracts/switch-view';
import './household.css';

const copy = t.household;
/** Bottom to top in each month's bar. */
const SECTOR_ORDER: Sector[] = ['electricity', 'gas', 'water', 'telecom', 'insurance', 'other'];
const EXPENSES = 'expenses';
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
/** Per-device choice: show expenses without an invoice on the chart and totals. */
const WITH_EXPENSES_KEY = 'faturometro.household.withExpenses';

function savedWithExpenses(): boolean {
  try {
    return localStorage.getItem(WITH_EXPENSES_KEY) === '1';
  } catch {
    return false;
  }
}

/** The household's last 12 months and an estimate of the next 12 (Início). */
export function HouseholdSection() {
  const { session } = useSession();
  const [withExpenses, setWithExpenses] = useState(savedWithExpenses);
  const summary = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, invoices, expenses] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.invoices.list(),
      session.repos.expenses.list(),
    ]);
    if (invoices.length === 0) return null;
    const date = today();
    return {
      ...householdSummary({ contracts, invoices, today: date }),
      expenses: expenses.length > 0 ? expensesYear(expenses, date) : null,
      switchSavingCents: await totalSwitchSavings(session.repos),
    };
  }, [session]);
  if (!summary) return null;

  const toggle = (on: boolean) => {
    setWithExpenses(on);
    try {
      localStorage.setItem(WITH_EXPENSES_KEY, on ? '1' : '0');
    } catch {
      // Not remembered on this device; the choice still applies now.
    }
  };
  const hasExpenses =
    summary.expenses !== null &&
    (summary.expenses.totalCents !== 0 || summary.expenses.forecastCents !== 0);
  const expenses = hasExpenses && withExpenses ? summary.expenses : null;
  const grandTotal = summary.totalCents + (expenses?.totalCents ?? 0);

  const bars: Bar[] = summary.months.map(({ month, totalCents, bySector }, index) => {
    const label = formatMonthShort(`${month}-01`);
    const extra = expenses?.months[index]?.totalCents ?? 0;
    return {
      key: month,
      label,
      title: expenses ? copy.monthTitleWithExpenses(label) : copy.monthTitle(label),
      value: (totalCents + extra) / 100,
      display: formatCents(totalCents + extra),
      parts: [
        ...SECTOR_ORDER.map((sector) => ({
          series: sector,
          value: (bySector[sector] ?? 0) / 100,
          display: formatCents(bySector[sector] ?? 0),
        })),
        ...(expenses
          ? [{ series: EXPENSES, value: extra / 100, display: formatCents(extra) }]
          : []),
      ],
    };
  });
  const series: Series[] = [
    ...SECTOR_ORDER.map((sector) => ({
      key: sector,
      label: t.sectors[sector],
      color: `var(--series-${sector})`,
    })),
    ...(expenses
      ? [{ key: EXPENSES, label: copy.expensesSeries, color: 'var(--series-expenses)' }]
      : []),
  ];
  const bySector = [
    ...summary.bySector.map(({ sector, totalCents }) => ({
      key: sector,
      label: t.sectors[sector],
      totalCents,
    })),
    ...(expenses && expenses.totalCents !== 0
      ? [{ key: EXPENSES, label: copy.expensesSeries, totalCents: expenses.totalCents }]
      : []),
  ].sort((a, b) => b.totalCents - a.totalCents);
  const previous = summary.previousTotalCents;
  const difference = previous === undefined ? 0 : summary.totalCents - previous;

  return (
    <section aria-labelledby="household-title">
      <h2 id="household-title" className="section-title">
        {copy.title}
      </h2>
      {hasExpenses && (
        <label className="household-toggle">
          <input
            type="checkbox"
            checked={withExpenses}
            onChange={(event) => toggle(event.target.checked)}
          />
          {copy.withExpenses}
        </label>
      )}
      <dl className="facts household-facts">
        <div>
          <dt>{expenses ? copy.invoicesTotal : copy.total}</dt>
          <dd>{formatCents(summary.totalCents)}</dd>
        </div>
        {expenses && (
          <div>
            <dt>{copy.totalWithExpenses}</dt>
            <dd>{formatCents(grandTotal)}</dd>
          </div>
        )}
        {summary.forecastCents !== null && (
          <div>
            <dt>{copy.forecast}</dt>
            <dd>{formatCents(summary.forecastCents)}</dd>
          </div>
        )}
        {expenses && (
          <div>
            <dt>{copy.forecastWithExpenses}</dt>
            <dd>{formatCents((summary.forecastCents ?? 0) + expenses.forecastCents)}</dd>
          </div>
        )}
      </dl>
      {previous !== undefined && (
        <p className="muted">
          {difference === 0 || previous === 0
            ? copy.same
            : copy.previous(
                formatCents(Math.abs(difference)),
                percent.format((Math.abs(difference) / previous) * 100),
                difference > 0,
              )}
          {expenses && ` ${copy.previousInvoicesOnly}`}
        </p>
      )}

      {summary.switchSavingCents !== null && summary.switchSavingCents !== 0 && (
        <p>
          <strong>
            {summary.switchSavingCents > 0
              ? copy.switchSaving(formatCents(summary.switchSavingCents))
              : copy.switchCost(formatCents(-summary.switchSavingCents))}
          </strong>
        </p>
      )}

      {bySector.length > 1 && (
        <>
          <h3>{copy.bySector}</h3>
          <dl className="facts household-facts">
            {bySector.map(({ key, label, totalCents }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {copy.share(
                    formatCents(totalCents),
                    percent.format(grandTotal > 0 ? (totalCents / grandTotal) * 100 : 0),
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <BarChart
        title={expenses ? copy.chartWithExpenses : copy.chart}
        bars={bars}
        formatTick={(value) => `${euros.format(value)} €`}
        tableLabel={t.contracts.charts.table}
        columnLabel={copy.month}
        valueLabel={copy.value}
        series={series}
      />
      <p className="muted">
        {copy.forecastNote}
        {expenses && ` ${copy.expensesNote}`}
      </p>
    </section>
  );
}
