/**
 * "Vale a pena sair já?" (telecom): the most an operator can charge for
 * leaving before the end of the loyalty period, against what a cheaper offer
 * saves until then. Pure; an estimate, never advice on whether to leave.
 *
 * Reference (CLAUDE.md rule 6), ANACOM consumer portal, "Períodos de
 * fidelização" (read 2026-10-18):
 * https://www.anacom-consumidor.pt/faq-periodos-de-fidelizacao
 * - Contracts from 14 November 2022: the charge cannot exceed 50 % of the
 *   monthly fees still to pay when leaving in the first year, 30 % in the
 *   second (initial loyalty, or a new one with a change to the installation).
 * - A new loyalty period without a change to the installation: 30 %, also
 *   for contracts from before 14 November 2022.
 * - Other contracts from before that date: the advantage still to recover,
 *   as quantified in the contract (the app cannot compute it).
 */
import type { Cents } from '../lib/money';
import type { IsoDate } from './types';

export const EARLY_EXIT_SOURCE = 'https://www.anacom-consumidor.pt/faq-periodos-de-fidelizacao';
/** Contracts signed from this day on follow the 50 % / 30 % limits. */
export const NEW_RULES_FROM = '2022-11-14';
/** Loyalty periods cannot exceed 24 months: the default start when the user does not say. */
const DEFAULT_LOYALTY_MONTHS = 24;

export type LoyaltyKind =
  /** First loyalty period, or a new one with a change to the installation. */
  | 'initial'
  /** A new loyalty period on the same installation. */
  | 'renewal_same_installation';

export interface EarlyExitInput {
  today: IsoDate;
  loyaltyEnd: IsoDate;
  /** When the loyalty period (and the contract) started; default: 24 months before the end. */
  loyaltyStart?: IsoDate;
  kind: LoyaltyKind;
  /** Monthly price with VAT now. */
  monthlyCents: Cents;
  /** Monthly price with VAT of the offer the user is considering. */
  newMonthlyCents?: Cents;
  /** The amount to leave now, when the invoice or the operator gives it. */
  statedChargeCents?: Cents;
}

export interface EarlyExit {
  loyaltyStart: IsoDate;
  /** Monthly fees still to pay until the end of the loyalty period (whole months, rounded up). */
  monthsLeft: number;
  remainingFeesCents: Cents;
  /** 1 or 2: the year of the loyalty period today. */
  year: 1 | 2;
  /** The legal cap in percent, or null when only the contract says (old contracts). */
  capPct: 50 | 30 | null;
  maxChargeCents: Cents | null;
  /** What the comparison uses: the stated amount, else the cap. */
  chargeCents: Cents | null;
  /** What the new offer saves until the loyalty period ends. */
  savingCents?: Cents;
  /** Saving minus the charge: positive means leaving now costs less. */
  balanceCents?: Cents;
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Whole months from `from` to `to`, a part of a month counting as one. */
export function monthsUntil(from: IsoDate, to: IsoDate): number {
  if (to <= from) return 0;
  let months = 0;
  while (addMonths(from, months) < to) months++;
  return months;
}

export function earlyExit(input: EarlyExitInput): EarlyExit {
  const loyaltyStart = input.loyaltyStart ?? addMonths(input.loyaltyEnd, -DEFAULT_LOYALTY_MONTHS);
  const monthsLeft = monthsUntil(input.today, input.loyaltyEnd);
  const remainingFeesCents = input.monthlyCents * monthsLeft;
  const year = input.today < addMonths(loyaltyStart, 12) ? 1 : 2;

  let capPct: EarlyExit['capPct'] = null;
  if (input.kind === 'renewal_same_installation') capPct = 30;
  else if (loyaltyStart >= NEW_RULES_FROM) capPct = year === 1 ? 50 : 30;

  const maxChargeCents = capPct === null ? null : Math.round((remainingFeesCents * capPct) / 100);
  const chargeCents = input.statedChargeCents ?? maxChargeCents;
  const result: EarlyExit = {
    loyaltyStart,
    monthsLeft,
    remainingFeesCents,
    year,
    capPct,
    maxChargeCents,
    chargeCents,
  };
  if (input.newMonthlyCents !== undefined) {
    result.savingCents = (input.monthlyCents - input.newMonthlyCents) * monthsLeft;
    if (chargeCents !== null) result.balanceCents = result.savingCents - chargeCents;
  }
  return result;
}
