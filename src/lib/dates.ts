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

/** "2026-06-24" → "jun 26" (chart axis labels). */
export function formatMonthShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${MONTHS_SHORT[Number(match[2]) - 1] ?? ''} ${match[1]?.slice(2)}`;
}
