/**
 * Links to COM.escolha, ANACOM's tariff comparator (docs/anacom-comescolha.md).
 * The app never calls ANACOM: it only builds a search address that the user
 * opens. The parameters live in src/data/comescolha.json, read from ANACOM's
 * forms and checked every week by scripts/comescolha-check.ts (run on the
 * maintainer's PC: ANACOM blocks GitHub's runners).
 */
import { z } from 'zod';
import { wholeEurosUp, type Cents } from '../lib/money';
import { TELECOM_SERVICES, type TelecomService } from './types';

const searchSchema = z.object({
  /** Results page, relative to `base`. */
  path: z.string().min(1),
  /** "All" filters (providers, loyalty, …) sent as they are. */
  fixed: z.record(z.string(), z.string()),
  /** Monthly limit in euros (dot decimal; a comma is silently ignored). */
  limitParam: z.string().min(1),
  /** Postal code prefix (4 digits); absent on the mobile search. */
  postalParam: z.string().min(1).optional(),
});

export const comEscolhaConfigSchema = z.object({
  schemaVersion: z.literal(1),
  /** When the parameters last changed (ISO date). */
  changedAt: z.string(),
  /** When the weekly check last passed (ISO date). */
  checkedAt: z.string(),
  base: z.string().url(),
  /** Two or more services. */
  combined: searchSchema.extend({
    serviceParam: z.string().min(1),
    serviceIds: z.object({
      internet: z.string().min(1),
      tv: z.string().min(1),
      landline: z.string().min(1),
      mobile: z.string().min(1),
    }),
  }),
  /** One service on its own. */
  single: z.object({
    internet: searchSchema,
    tv: searchSchema,
    landline: searchSchema,
    mobile: searchSchema,
  }),
});
export type ComEscolhaConfig = z.infer<typeof comEscolhaConfigSchema>;

export interface ComEscolhaSearch {
  services: readonly TelecomService[];
  /** What the user pays per month: only offers up to this (rounded up to whole euros). */
  monthlyLimitCents?: Cents;
  /** First 4 digits of the postal code (coverage). Never stored. */
  postalPrefix?: string;
}

/** Search address for these services, or null without services. */
export function comEscolhaUrl(config: ComEscolhaConfig, search: ComEscolhaSearch): string | null {
  const services = TELECOM_SERVICES.filter((service) => search.services.includes(service));
  const [only] = services;
  if (!only) return null;
  const target = services.length > 1 ? config.combined : config.single[only];
  const params = new URLSearchParams();
  if (services.length > 1) {
    for (const service of services) {
      params.append(config.combined.serviceParam, config.combined.serviceIds[service]);
    }
  }
  for (const [name, value] of Object.entries(target.fixed)) params.append(name, value);
  if (search.monthlyLimitCents !== undefined && search.monthlyLimitCents > 0) {
    params.append(target.limitParam, String(wholeEurosUp(search.monthlyLimitCents)));
  }
  if (target.postalParam && search.postalPrefix && /^\d{4}$/.test(search.postalPrefix)) {
    params.append(target.postalParam, search.postalPrefix);
  }
  return `${new URL(target.path, config.base).href}?${params.toString()}`;
}

/** How many recent invoices the monthly average uses. */
export const AVERAGE_INVOICES = 3;

/**
 * Average of the latest invoices (telecom bills monthly). Credit notes and
 * zero totals are left out. Null without invoices.
 */
export function monthlyAverage(
  invoices: readonly { issueDate: string; totalCents: Cents }[],
): { cents: Cents; count: number } | null {
  const latest = invoices
    .filter((invoice) => invoice.totalCents > 0)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .slice(0, AVERAGE_INVOICES);
  if (latest.length === 0) return null;
  const sum = latest.reduce((total, invoice) => total + invoice.totalCents, 0);
  return { cents: Math.round(sum / latest.length), count: latest.length };
}

/** Days without a passing check after which the administrator is reminded. */
export const CHECK_STALE_DAYS = 14;

/** Whether the weekly check has not passed for too long (dates as YYYY-MM-DD). */
export function checkIsStale(checkedAt: string, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(checkedAt)) / 86_400_000;
  return !(days <= CHECK_STALE_DAYS);
}
