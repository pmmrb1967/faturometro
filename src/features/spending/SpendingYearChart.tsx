import { useId, type ReactNode } from 'react';
import { niceMax } from '../../components/chart-scale';
import '../../components/chart.css';
import { addMonthsTo } from '../../domain/month';
import type { YearProgress } from '../../domain/spending';
import { t } from '../../i18n/pt-PT';
import { formatMonth } from '../../lib/dates';
import { formatCents, type Cents } from '../../lib/money';
import { HEIGHT, PAD, TICKS, useChartPointer, useDrawingWidth } from './chart-frame';

const copy = t.spending;
const year = copy.year;
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const MONTHS = 12;

/** Runs of consecutive months with a value: a month with nothing recorded is a gap. */
function segments(values: readonly (Cents | null)[]): [number, Cents][][] {
  const runs: [number, Cents][][] = [];
  let run: [number, Cents][] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push([index, value]);
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

function summaryOf({ year: shown, current, spent, compared }: YearProgress): string {
  const previousYear = addMonthsTo(`${shown}-01`, -12).slice(0, 4);
  if (!spent) return year.nothing(shown);
  const first = year.spent(year.months[spent.lastMonth] ?? '', formatCents(spent.totalCents));
  if (!compared) return first;
  const allOfThem = compared.months === current.filter((value) => value !== null).length;
  return allOfThem
    ? `${first} ${year.samePeriod(previousYear, formatCents(compared.previousCents))}`
    : `${first} ${year.inBoth(
        shown,
        formatCents(compared.currentCents),
        previousYear,
        formatCents(compared.previousCents),
      )}`;
}

/** Money spent each month, against the same months of the year before and what came in. */
export function YearChart({
  progress,
  switcher,
}: {
  progress: YearProgress;
  switcher: ReactNode;
}) {
  const titleId = useId();
  const { plot, width } = useDrawingWidth();
  const { current, previous, income, spent, purchasesSince } = progress;
  const lastIndex = spent?.lastMonth ?? MONTHS - 1;
  const { active, handlers } = useChartPointer(MONTHS, width, lastIndex);
  const max = niceMax(Math.max(...[...current, ...previous, ...income].map((value) => value ?? 0)));
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (index / (MONTHS - 1)) * (width - PAD.left - PAD.right);
  const y = (cents: number) => PAD.top + plotHeight - (Math.max(cents, 0) / max) * plotHeight;
  const hasIncome = income.some((value) => value !== null);
  const hasPrevious = previous.some((value) => value !== null);
  const names = {
    current: progress.year,
    previous: addMonthsTo(`${progress.year}-01`, -12).slice(0, 4),
  };
  const summary = summaryOf(progress);

  const lines = (values: readonly (Cents | null)[], className: string) =>
    segments(values).map((run) => (
      <polyline
        key={run[0]?.[0]}
        className={className}
        points={run.map(([index, cents]) => `${x(index)},${y(cents)}`).join(' ')}
      />
    ));
  // A dot on each month: a month alone between two gaps has no line to show it.
  const dots = (values: readonly (Cents | null)[], className: string) =>
    values.map((value, index) =>
      value === null ? null : (
        <circle key={index} className={className} cx={x(index)} cy={y(value)} r={4} />
      ),
    );

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption className="spending-chart-head">
        <span id={titleId} className="chart-title">
          {year.title}
        </span>
        {switcher}
      </figcaption>
      <p className="muted spending-progress">{summary}</p>
      <div className="chart-plot" ref={plot}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="spending-line"
          role="img"
          aria-label={`${year.title}. ${summary}`}
          tabIndex={0}
          {...handlers}
        >
          {Array.from({ length: TICKS + 1 }, (_, index) => {
            const value = (max / TICKS) * index;
            return (
              <g key={index} className="chart-grid">
                <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
                <text x={PAD.left - 6} y={y(value)} dy="0.32em" textAnchor="end">
                  {euros.format(value / 100)} €
                </text>
              </g>
            );
          })}
          {year.months.map((name, index) => (
            <text
              key={name}
              className="chart-axis"
              x={x(index)}
              y={HEIGHT - 6}
              textAnchor="middle"
            >
              {name.charAt(0).toUpperCase()}
            </text>
          ))}
          {active !== null && (
            <line
              className="spending-guide"
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
            />
          )}
          {lines(income, 'spending-income')}
          {dots(income, 'spending-income-point')}
          {lines(previous, 'spending-previous')}
          {dots(previous, 'spending-previous-point')}
          {lines(current, 'spending-current')}
          {dots(current, 'spending-current-point')}
        </svg>
        {active !== null && (
          <div
            className="chart-tooltip"
            role="status"
            style={{ left: `${Math.min(Math.max((x(active) / width) * 100, 24), 76)}%` }}
          >
            <span>{formatMonth(`${names.current}-${String(active + 1).padStart(2, '0')}`)}</span>
            {current[active] !== null && current[active] !== undefined && (
              <strong>
                {names.current}: {formatCents(current[active])}
              </strong>
            )}
            {previous[active] !== null && previous[active] !== undefined && (
              <span>
                {names.previous}: {formatCents(previous[active])}
              </span>
            )}
            {income[active] !== null && income[active] !== undefined && (
              <span>
                {copy.progress.incomeLabel}: {formatCents(income[active])}
              </span>
            )}
          </div>
        )}
      </div>
      <ul className="chart-legend">
        <li>
          <i style={{ background: 'var(--chart-mark)' }} aria-hidden="true" />
          {names.current}
        </li>
        {hasPrevious && (
          <li>
            <i style={{ background: 'var(--chart-context)' }} aria-hidden="true" />
            {names.previous}
          </li>
        )}
        {hasIncome && (
          <li>
            <i className="spending-income-key" aria-hidden="true" />
            {year.incomeKey}
          </li>
        )}
      </ul>
      {purchasesSince && (
        <p className="muted spending-year-note">
          {year.purchasesNote(formatMonth(purchasesSince))}
        </p>
      )}
      <details className="chart-table">
        <summary>{copy.progress.table}</summary>
        <table>
          <caption>{year.title}</caption>
          <thead>
            <tr>
              <th scope="col">{year.month}</th>
              <th scope="col">{names.current}</th>
              {hasPrevious && <th scope="col">{names.previous}</th>}
              {hasIncome && <th scope="col">{copy.progress.incomeLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {year.months.map((name, index) => {
              const cell = (value: Cents | null | undefined) =>
                value === null || value === undefined ? '—' : formatCents(value);
              return (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{cell(current[index])}</td>
                  {hasPrevious && <td>{cell(previous[index])}</td>}
                  {hasIncome && <td>{cell(income[index])}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
