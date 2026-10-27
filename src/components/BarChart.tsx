import { useId, useState } from 'react';
import './chart.css';

export interface Bar {
  key: string;
  /** Short axis label (e.g. "jun 26"). */
  label: string;
  /** Long label for the tooltip and screen readers (e.g. "Fatura de 24-06-2026"). */
  title: string;
  /** The table's first column (e.g. "24-06-2026"); defaults to `label`. */
  cell?: string;
  value: number;
  /** Formatted value ("42,79 €", "226 kWh"). */
  display: string;
  /** Stacked parts, in the order of `series` (their values add up to `value`). */
  parts?: { series: string; value: number; display: string }[];
}

/** One colour of a stacked chart. */
export interface Series {
  key: string;
  label: string;
  /** Shorter table header for a long label ("Telecom."); the full label stays as its tooltip. */
  short?: string;
  /** CSS colour (a custom property such as var(--series-energy)). */
  color: string;
}

interface Props {
  title: string;
  bars: Bar[];
  /** Formats axis tick values. */
  formatTick: (value: number) => string;
  tableLabel: string;
  columnLabel: string;
  valueLabel: string;
  /** Stacked bars: the colours and their order, bottom to top. */
  series?: Series[];
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 24, right: 8, bottom: 28, left: 56 };
const GAP = 2;
const RADIUS = 4;
const TICKS = 4;

/** An axis maximum whose quarters are round numbers (1, 2, 4, 6, 8 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 6, 8, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/** Bar with a 4px rounded data end, anchored square on the baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

export function BarChart({
  title,
  bars,
  formatTick,
  tableLabel,
  columnLabel,
  valueLabel,
  series,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  if (bars.length === 0) return null;

  const max = niceMax(Math.max(...bars.map((bar) => bar.value)));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / bars.length;
  const barWidth = Math.max(2, Math.min(36, slot * 0.7) - GAP);
  const y = (value: number) => PAD.top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const labelEvery = Math.ceil(bars.length / 8);
  const last = bars.length - 1;
  const shown = active === null ? null : bars[active];
  // Series with a value somewhere: the legend and table leave the others out.
  const tableSeries = (series ?? []).filter((entry) =>
    bars.some((bar) => bar.parts?.some((part) => part.series === entry.key && part.value > 0)),
  );
  const colorOf = (key: string) => series?.find((entry) => entry.key === key)?.color;
  const labelOf = (key: string) => series?.find((entry) => entry.key === key)?.label ?? key;

  /** Segments bottom to top; only the top one has the rounded data end. */
  function stack(bar: Bar, order: Series[], centre: number) {
    const parts = order
      .map((entry) => bar.parts?.find((part) => part.series === entry.key))
      .filter((part): part is NonNullable<Bar['parts']>[number] => Boolean(part && part.value > 0));
    let base = PAD.top + plotHeight;
    return parts.map((part, index) => {
      const height = (part.value / max) * plotHeight;
      base -= height;
      const x = centre - barWidth / 2;
      const style = { fill: colorOf(part.series) };
      return index === parts.length - 1 ? (
        <path key={part.series} d={barPath(x, base, barWidth, height)} style={style} />
      ) : (
        <rect key={part.series} x={x} y={base} width={barWidth} height={height} style={style} />
      );
    });
  }

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption id={titleId} className="chart-title">
        {title}
      </figcaption>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={titleId}>
          {Array.from({ length: TICKS + 1 }, (_, index) => {
            const value = (max / TICKS) * index;
            const lineY = y(value);
            return (
              <g key={index} className="chart-grid">
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={lineY} y2={lineY} />
                <text x={PAD.left - 8} y={lineY} dy="0.32em" textAnchor="end">
                  {formatTick(value)}
                </text>
              </g>
            );
          })}
          {bars.map((bar, index) => {
            const centre = PAD.left + slot * index + slot / 2;
            const top = y(bar.value);
            const height = PAD.top + plotHeight - top;
            return (
              <g
                key={bar.key}
                className={active === index ? 'chart-bar is-active' : 'chart-bar'}
                tabIndex={0}
                role="img"
                aria-label={`${bar.title}: ${bar.display}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                {/* Hit target wider and taller than the mark. */}
                <rect
                  className="chart-hit"
                  x={centre - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={plotHeight}
                />
                {height > 0 && !(series && bar.parts) && (
                  <path d={barPath(centre - barWidth / 2, top, barWidth, height)} />
                )}
                {height > 0 && series && bar.parts && stack(bar, series, centre)}
                {(index % labelEvery === 0 || index === last) && (
                  <text className="chart-axis" x={centre} y={HEIGHT - 8} textAnchor="middle">
                    {bar.label}
                  </text>
                )}
                {index === last && (
                  <text className="chart-value" x={centre} y={top - 6} textAnchor="middle">
                    {bar.display}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {shown && active !== null && (
          <div
            className="chart-tooltip"
            role="status"
            style={{
              left: `${((PAD.left + slot * active + slot / 2) / WIDTH) * 100}%`,
            }}
          >
            <span>{shown.title}</span>
            {series &&
              shown.parts
                ?.filter((part) => part.value > 0)
                .map((part) => (
                  <span key={part.series} className="chart-tooltip-part">
                    <i style={{ background: colorOf(part.series) }} aria-hidden="true" />
                    {labelOf(part.series)}: {part.display}
                  </span>
                ))}
            <strong>{shown.display}</strong>
          </div>
        )}
      </div>
      {series && (
        <ul className="chart-legend">
          {series
            .filter((entry) =>
              bars.some((bar) =>
                bar.parts?.some((part) => part.series === entry.key && part.value > 0),
              ),
            )
            .map((entry) => (
              <li key={entry.key}>
                <i style={{ background: entry.color }} aria-hidden="true" />
                {entry.label}
              </li>
            ))}
        </ul>
      )}
      <details className="chart-table">
        <summary>{tableLabel}</summary>
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{columnLabel}</th>
              {tableSeries.map((entry) => (
                <th key={entry.key} scope="col">
                  {entry.short ? <abbr title={entry.label}>{entry.short}</abbr> : entry.label}
                </th>
              ))}
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key}>
                <th scope="row">{bar.cell ?? bar.label}</th>
                {tableSeries.map((entry) => (
                  <td key={entry.key}>
                    {bar.parts?.find((part) => part.series === entry.key)?.display ?? '—'}
                  </td>
                ))}
                <td>{bar.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
