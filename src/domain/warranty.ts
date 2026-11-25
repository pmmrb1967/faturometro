/**
 * Legal warranty of a purchase (docs/garantias.md): it runs from the day the
 * good was delivered for a number of months (36 by law, 18 when agreed for a
 * used good). Only the essentials: end date, state and an alert before the
 * end. Pure: no React, no database.
 */
import type { Warranty } from './types';

/** Months of the legal warranty (DL 84/2021, art. 12.º, n.os 1 e 3). */
export const WARRANTY_MONTHS = { new: 36, usedAgreed: 18 } as const;

/** Days before the end when the warranty is "a terminar" and an alert appears. */
export const WARRANTY_ENDING_DAYS = 60;

export type WarrantyState = 'active' | 'ending' | 'ended';

export interface WarrantyStatus {
  state: WarrantyState;
  /** Last day covered. */
  endDate: string;
  /** Negative once it ended. */
  daysLeft: number;
  /** 0 on delivery, 1 at the end. */
  progress: number;
}

function utc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * The same day `months` later (the last day of a shorter month): delivered on
 * 2024-01-31, 36 months end on 2027-01-31; on 2024-02-29, on 2027-02-28.
 */
export function addMonthsToDate(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const day = Number(date.slice(8, 10));
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const last = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, last)))
    .toISOString()
    .slice(0, 10);
}

export function warrantyEnd(warranty: Pick<Warranty, 'deliveryDate' | 'months'>): string {
  return addMonthsToDate(warranty.deliveryDate, warranty.months);
}

export function warrantyStatus(
  warranty: Pick<Warranty, 'deliveryDate' | 'months'>,
  today: string,
): WarrantyStatus {
  const endDate = warrantyEnd(warranty);
  const daysLeft = daysBetween(today, endDate);
  const total = daysBetween(warranty.deliveryDate, endDate);
  const progress =
    total > 0 ? Math.min(1, Math.max(0, daysBetween(warranty.deliveryDate, today) / total)) : 1;
  const state: WarrantyState =
    daysLeft < 0 ? 'ended' : daysLeft <= WARRANTY_ENDING_DAYS ? 'ending' : 'active';
  return { state, endDate, daysLeft, progress };
}

/** Still running first, the closest end first; ended ones last, the latest first. */
export function sortWarranties<T extends Pick<Warranty, 'deliveryDate' | 'months'>>(
  warranties: readonly T[],
  today: string,
): T[] {
  return [...warranties].sort((a, b) => {
    const endA = warrantyEnd(a);
    const endB = warrantyEnd(b);
    const endedA = endA < today;
    const endedB = endB < today;
    if (endedA !== endedB) return endedA ? 1 : -1;
    return endedA ? endB.localeCompare(endA) : endA.localeCompare(endB);
  });
}
