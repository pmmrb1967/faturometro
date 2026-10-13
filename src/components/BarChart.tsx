import { useId, useState } from 'react';
import './chart.css';

export interface Bar {
  key: string;
  /** Short axis label (e.g. "jun 26"). */
  label: string;
  /** Long label for the tooltip and table (e.g. "Fatura de 24-06-2026"). */
  title: string;
  value: number;
  /** Formatted value ("42,79 €", "226 kWh"). */
  display: string;
}

interface Props {
  title: string;
  bars: Bar[];
  /** Formats axis tick values. */
  formatTick: (value: number) => string;
  tableLabel: string;
  columnLabel: string;
  valueLabel: string;
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

export function BarChart({ title, bars, formatTick, tableLabel, columnLabel, valueLabel }: Props) {
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
                {height > 0 && <path d={barPath(centre - barWidth / 2, top, barWidth, height)} />}
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
            <strong>{shown.display}</strong>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>{tableLabel}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{columnLabel}</th>
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key}>
                <td>{bar.title}</td>
                <td>{bar.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
