/**
 * Legal warranty of a purchase (docs/garantias.md): it runs from the day the
 * good was delivered for a number of months (36 by law, 18 when agreed for a
 * used good). The end date, the state, the dates that matter before it, and
 * the alerts. Pure: no React, no database.
 */
import type { Warranty } from './types';

/** Months of the legal warranty (DL 84/2021, art. 12.º, n.os 1 e 3). */
export const WARRANTY_MONTHS = { new: 36, usedAgreed: 18 } as const;

/**
 * The first days after delivery when a defect lets the buyer ask at once for a
 * new good or the money back, without accepting a repair (art. 16.º).
 */
export const REJECTION_DAYS = 30;

/**
 * Months after delivery while a defect is presumed to have been there when the
 * good arrived: 24 with the 3-year warranty, 12 with the 18 months agreed for a
 * used good (art. 13.º, n.os 1, 3 e 4).
 */
export const PRESUMPTION_MONTHS = { new: 24, usedAgreed: 12 } as const;

/** Days before the presumption ends when an alert appears. */
export const PRESUMPTION_ALERT_DAYS = 30;

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

export type MilestoneKind = 'rejection' | 'presumption' | 'end';

export interface WarrantyMilestone {
  kind: MilestoneKind;
  date: string;
}

/** Which legal term a warranty has: the law's two, or one the user wrote (a brand's). */
export function warrantyTerm(warranty: Pick<Warranty, 'months'>): 'new' | 'usedAgreed' | 'other' {
  if (warranty.months === WARRANTY_MONTHS.new) return 'new';
  if (warranty.months === WARRANTY_MONTHS.usedAgreed) return 'usedAgreed';
  return 'other';
}

function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The dates that matter, in order: the end of the first 30 days and of the
 * presumption of the defect (only for the law's terms; the law says nothing
 * of a term the user wrote), and the last day.
 */
export function warrantyMilestones(
  warranty: Pick<Warranty, 'deliveryDate' | 'months'>,
): WarrantyMilestone[] {
  const term = warrantyTerm(warranty);
  const end: WarrantyMilestone = { kind: 'end', date: warrantyEnd(warranty) };
  if (term === 'other') return [end];
  return [
    { kind: 'rejection', date: addDays(warranty.deliveryDate, REJECTION_DAYS) },
    {
      kind: 'presumption',
      date: addMonthsToDate(warranty.deliveryDate, PRESUMPTION_MONTHS[term]),
    },
    end,
  ];
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
