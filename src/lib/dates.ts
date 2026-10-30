/** "2026-07-24" → "24-07-2026" (display only; storage is always ISO). */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : iso;
}

const MONTHS_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

const MONTH_NAME = new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-10" → "outubro de 2026". */
export function formatMonth(month: string): string {
  return MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));
}

/** "2026-06-24" → "jun 26" (chart axis labels). */
export function formatMonthShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${MONTHS_SHORT[Number(match[2]) - 1] ?? ''} ${match[1]?.slice(2)}`;
}
