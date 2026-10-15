/** How invoices and contracts are grouped and described in lists. */
import type { Sector } from './types';

/** Blocks of the invoice and contract lists, in this order. */
export const SECTOR_GROUPS = [
  { id: 'energy', sectors: ['electricity', 'gas'] },
  { id: 'telecom', sectors: ['telecom'] },
  { id: 'water', sectors: ['water'] },
  { id: 'insurance', sectors: ['insurance'] },
  { id: 'other', sectors: ['other'] },
] as const satisfies readonly { id: string; sectors: readonly Sector[] }[];

export type SectorGroup = (typeof SECTOR_GROUPS)[number]['id'];

export function groupOf(sector: Sector): SectorGroup {
  return (
    SECTOR_GROUPS.find((group) => (group.sectors as readonly Sector[]).includes(sector))?.id ??
    'other'
  );
}

/** Items in group order (groups without items are left out). */
export function byGroup<T>(
  items: readonly T[],
  sectorOf: (item: T) => Sector,
): { group: SectorGroup; items: T[] }[] {
  return SECTOR_GROUPS.map((group) => ({
    group: group.id,
    items: items.filter((item) => groupOf(sectorOf(item)) === group.id),
  })).filter((entry) => entry.items.length > 0);
}

export type BillingFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual';

/** Billing period lengths (inclusive days) for each frequency. */
const FREQUENCIES: [BillingFrequency, number, number][] = [
  ['monthly', 25, 35],
  ['bimonthly', 55, 66],
  ['quarterly', 85, 95],
  ['semiannual', 175, 190],
  ['annual', 355, 375],
];

/** How often the invoice is billed, from its period; undefined when unknown or irregular. */
export function billingFrequency(
  periodStart: string | undefined,
  periodEnd: string | undefined,
): BillingFrequency | undefined {
  if (!periodStart || !periodEnd) return undefined;
  const days =
    Math.round(
      (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  return FREQUENCIES.find(([, min, max]) => days >= min && days <= max)?.[0];
}
