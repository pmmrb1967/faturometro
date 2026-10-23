import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { BarChart, type Bar, type Series } from '../../components/BarChart';
import type { Sector } from '../../domain/types';
import { expensesYear, householdSummary, type ExpensesYear } from '../../domain/household';
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
const ONE_OFF = 'oneOff';
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
/** Per-device choice: show expenses without an invoice on the chart and totals. */
const WITH_EXPENSES_KEY = 'faturometro.household.withExpenses';
/** Per-device choice: show one-off expenses (works, appliances) too. */
const WITH_ONE_OFF_KEY = 'faturometro.household.withOneOff';

function saved(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Not remembered on this device; the choice still applies now.
  }
}

const hasAny = (year: ExpensesYear | null): year is ExpensesYear =>
  year !== null && (year.totalCents !== 0 || year.forecastCents !== 0);

/** The household's last 12 months and an estimate of the next 12 (Início). */
export function HouseholdSection() {
  const { session } = useSession();
  const [withExpenses, setWithExpenses] = useState(() => saved(WITH_EXPENSES_KEY));
  const [withOneOff, setWithOneOff] = useState(() => saved(WITH_ONE_OFF_KEY));
  const summary = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, invoices, expenses] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.invoices.list(),
      session.repos.expenses.list(),
    ]);
    if (invoices.length === 0) return null;
    const date = today();
    const recurring = expenses.filter((expense) => !expense.oneOff);
    const oneOff = expenses.filter((expense) => expense.oneOff);
    return {
      ...householdSummary({ contracts, invoices, today: date }),
      expenses: recurring.length > 0 ? expensesYear(recurring, date) : null,
      oneOff: oneOff.length > 0 ? expensesYear(oneOff, date) : null,
      switchSavingCents: await totalSwitchSavings(session.repos),
    };
  }, [session]);
  if (!summary) return null;

  const hasExpenses = hasAny(summary.expenses);
  const hasOneOff = hasAny(summary.oneOff);
  const expenses = hasExpenses && withExpenses ? summary.expenses : null;
  const oneOff = hasOneOff && withOneOff ? summary.oneOff : null;
  const anyExtra = expenses !== null || oneOff !== null;
  const extras = copy.extras(expenses !== null, oneOff !== null);
  const grandTotal = summary.totalCents + (expenses?.totalCents ?? 0) + (oneOff?.totalCents ?? 0);

  const bars: Bar[] = summary.months.map(({ month, totalCents, bySector }, index) => {
    const label = formatMonthShort(`${month}-01`);
    const extra = expenses?.months[index]?.totalCents ?? 0;
    const once = oneOff?.months[index]?.totalCents ?? 0;
    return {
      key: month,
      label,
      title: anyExtra ? copy.monthTitleWithExpenses(label, extras) : copy.monthTitle(label),
      value: (totalCents + extra + once) / 100,
      display: formatCents(totalCents + extra + once),
      parts: [
        ...SECTOR_ORDER.map((sector) => ({
          series: sector,
          value: (bySector[sector] ?? 0) / 100,
          display: formatCents(bySector[sector] ?? 0),
        })),
        ...(expenses
          ? [{ series: EXPENSES, value: extra / 100, display: formatCents(extra) }]
          : []),
        ...(oneOff ? [{ series: ONE_OFF, value: once / 100, display: formatCents(once) }] : []),
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
    ...(oneOff ? [{ key: ONE_OFF, label: copy.oneOffSeries, color: 'var(--series-one-off)' }] : []),
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
    ...(oneOff && oneOff.totalCents !== 0
      ? [{ key: ONE_OFF, label: copy.oneOffSeries, totalCents: oneOff.totalCents }]
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
            onChange={(event) => {
              setWithExpenses(event.target.checked);
              remember(WITH_EXPENSES_KEY, event.target.checked);
            }}
          />
          {copy.withExpenses}
        </label>
      )}
      {hasOneOff && (
        <label className="household-toggle">
          <input
            type="checkbox"
            checked={withOneOff}
            onChange={(event) => {
              setWithOneOff(event.target.checked);
              remember(WITH_ONE_OFF_KEY, event.target.checked);
            }}
          />
          {copy.withOneOff}
        </label>
      )}
      <dl className="facts household-facts">
        <div>
          <dt>{anyExtra ? copy.invoicesTotal : copy.total}</dt>
          <dd>{formatCents(summary.totalCents)}</dd>
        </div>
        {anyExtra && (
          <div>
            <dt>{copy.totalWithExpenses(extras)}</dt>
            <dd>{formatCents(grandTotal)}</dd>
          </div>
        )}
        {summary.forecastCents !== null && (
          <div>
            <dt>{copy.forecast}</dt>
            <dd>{formatCents(summary.forecastCents)}</dd>
          </div>
        )}
        {anyExtra && (
          <div>
            <dt>{copy.forecastWithExpenses(extras)}</dt>
            <dd>
              {formatCents(
                (summary.forecastCents ?? 0) +
                  (expenses?.forecastCents ?? 0) +
                  (oneOff?.forecastCents ?? 0),
              )}
            </dd>
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
          {anyExtra && ` ${copy.previousInvoicesOnly}`}
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
        title={anyExtra ? copy.chartWithExpenses(extras) : copy.chart}
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
        {oneOff && ` ${copy.oneOffNote}`}
      </p>
    </section>
  );
}
