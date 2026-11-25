import { t } from '../../i18n/pt-PT';
import type { LineKind } from './line-kind';

const PATHS: Record<LineKind, string> = {
  // A sheet with lines: an invoice (the forecast is one still to come).
  invoice: 'M4 1.5h6l2.5 2.5v10.5h-8.5zM6 6h5M6 8.5h5M6 11h3',
  forecast: 'M4 1.5h6l2.5 2.5v10.5h-8.5zM6 6h5M6 8.5h5M6 11h3',
  // Two arrows round: it comes back every month.
  expense: 'M13 6.5a5 5 0 0 0-9.2-1.8M3 2.5v2.4h2.4M3 9.5a5 5 0 0 0 9.2 1.8M13 13.5v-2.4h-2.4',
  // A bag: bought once.
  oneOff: 'M3.5 5.5h9l-.8 9h-7.4zM6 5.5V4a2 2 0 0 1 4 0v1.5',
};

/** The kind of a line, in words and with an icon, under it on the left. */
export function KindTag({ kind, label }: { kind: LineKind; label?: string }) {
  return (
    <span className="month-kind">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d={PATHS[kind]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={kind === 'forecast' ? '2 1.6' : undefined}
        />
      </svg>
      {label ?? t.month.kinds[kind]}
    </span>
  );
}
