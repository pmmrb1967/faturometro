import { useId, type ReactNode } from 'react';
import { niceMax } from '../../components/chart-scale';
import '../../components/chart.css';
import { addMonthsTo } from '../../domain/month';
import { categoryShare, type MonthProgress, type SpendingMonth } from '../../domain/spending';
import { t } from '../../i18n/pt-PT';
import { formatMonth } from '../../lib/dates';
import { formatCents, type Cents } from '../../lib/money';
import { HEIGHT, PAD, TICKS, useChartPointer, useDrawingWidth } from './chart-frame';

const copy = t.spending;
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/**
 * Ranked bars on one baseline, not a pie: with ten categories the small ones must stay readable.
 * Each track is the whole month, so a bar says the same as the percentage beside it.
 */
export function CategoryChart({ summary }: { summary: SpendingMonth }) {
  return (
    <figure className="chart">
      <figcaption className="chart-title">{copy.byCategory}</figcaption>
      <ul className="spending-bars">
        {summary.byCategory.map(({ category, totalCents }) => {
          const share = categoryShare(totalCents, summary.byCategory);
          return (
            <li key={category}>
              <span>{copy.categories[category]}</span>
              <strong>{formatCents(totalCents)}</strong>
              <span className="muted">{share} %</span>
              <span className="spending-bar" aria-hidden="true">
                {totalCents > 0 && <span style={{ width: `${share}%` }} />}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/**
 * Money spent up to each day, against the same days of the month before and,
 * when there is any, the income of the month as a level to stay under.
 */
export function ProgressChart({
  month,
  progress,
  incomeCents = 0,
  past = false,
  switcher,
}: {
  month: string;
  progress: MonthProgress;
  incomeCents?: Cents;
  /** The month is over: the text says how it ended, not what is left. */
  past?: boolean;
  switcher: ReactNode;
}) {
  const titleId = useId();
  const { plot, width } = useDrawingWidth();
  const { current, previous, days } = progress;
  const { active, handlers } = useChartPointer(days, width, current.length - 1);
  const max = niceMax(Math.max(...current, ...previous, incomeCents));
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (index / Math.max(days - 1, 1)) * plotWidth;
  const y = (cents: number) => PAD.top + plotHeight - (Math.max(cents, 0) / max) * plotHeight;
  const line = (values: readonly number[]) =>
    values.map((cents, index) => `${x(index)},${y(cents)}`).join(' ');

  const lastIndex = current.length - 1;
  const atLast = current[lastIndex] ?? 0;
  const left = incomeCents - atLast;
  const againstIncome =
    left >= 0
      ? (past ? copy.progress.incomeBelow : copy.progress.incomeLeft)(formatCents(left))
      : (past ? copy.progress.incomeAbove : copy.progress.incomeOver)(formatCents(-left));
  const summary = [
    copy.progress.summary(
      current.length,
      formatCents(atLast),
      formatCents(previous[Math.min(lastIndex, previous.length - 1)] ?? 0),
    ),
    ...(incomeCents > 0 ? [againstIncome] : []),
  ].join(' ');
  const names = { current: formatMonth(month), previous: formatMonth(addMonthsTo(month, -1)) };

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption className="spending-chart-head">
        <span id={titleId} className="chart-title">
          {copy.progress.title}
        </span>
        {switcher}
      </figcaption>
      <p className="muted spending-progress">{summary}</p>
      <div className="chart-plot" ref={plot}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="spending-line"
          role="img"
          aria-label={`${copy.progress.title}. ${summary}`}
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
          {[1, 10, 20, days].map((day) => (
            <text
              key={day}
              className="chart-axis"
              x={x(day - 1)}
              y={HEIGHT - 6}
              textAnchor="middle"
            >
              {day}
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
          {incomeCents > 0 && (
            <>
              <line
                className="spending-income"
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(incomeCents)}
                y2={y(incomeCents)}
              />
              <text
                className="chart-axis spending-income-label"
                x={width - PAD.right}
                y={y(incomeCents) - 5}
                textAnchor="end"
              >
                {copy.progress.incomeLabel}
              </text>
            </>
          )}
          <polyline className="spending-previous" points={line(previous)} />
          <polyline className="spending-current" points={line(current)} />
          {current.length > 0 && (
            <circle className="spending-dot" cx={x(lastIndex)} cy={y(atLast)} r={4} />
          )}
        </svg>
        {active !== null && (
          <div
            className="chart-tooltip"
            role="status"
            style={{ left: `${Math.min(Math.max((x(active) / width) * 100, 24), 76)}%` }}
          >
            <span>{copy.progress.dayLabel(active + 1)}</span>
            {current[active] !== undefined && (
              <strong>
                {names.current}: {formatCents(current[active])}
              </strong>
            )}
            {previous[active] !== undefined && (
              <span>
                {names.previous}: {formatCents(previous[active])}
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
        <li>
          <i style={{ background: 'var(--chart-context)' }} aria-hidden="true" />
          {names.previous}
        </li>
        {incomeCents > 0 && (
          <li>
            <i className="spending-income-key" aria-hidden="true" />
            {copy.progress.incomeKey}
          </li>
        )}
      </ul>
      <details className="chart-table">
        <summary>{copy.progress.table}</summary>
        <table>
          <caption>{copy.progress.title}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.progress.day}</th>
              <th scope="col">{names.current}</th>
              <th scope="col">{names.previous}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: days }, (_, index) => (
              <tr key={index}>
                <th scope="row">{index + 1}</th>
                <td>{current[index] === undefined ? '—' : formatCents(current[index])}</td>
                <td>{previous[index] === undefined ? '—' : formatCents(previous[index])}</td>
              </tr>
            ))}
          </tbody>
          {incomeCents > 0 && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {copy.progress.incomeKey}
                </th>
                <td>{formatCents(incomeCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </details>
    </figure>
  );
}
