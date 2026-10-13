/**
 * Normalized ERSE electricity offers (public/data/erse-offers.json), produced
 * by scripts/erse-sync.ts. Format of the source: docs/erse-data.md.
 * Prices are €/day and €/kWh WITHOUT VAT, as decimal numbers.
 */
import { z } from 'zod';

/** Billing cycles as the ERSE codes them: 1 simple, 2 bi-hourly, 3 tri-hourly. */
export const cycleCodeSchema = z.enum(['1', '2', '3']);
export type CycleCode = z.infer<typeof cycleCodeSchema>;

export const cyclePricesSchema = z.object({
  /** Fixed term, €/day. */
  fixedPerDay: z.number(),
  /** Simple: one price. */
  simple: z.number().optional(),
  /** Bi-hourly. */
  offEmpty: z.number().optional(),
  empty: z.number().optional(),
  /** Tri-hourly ("empty" shared with bi-hourly). */
  peak: z.number().optional(),
  full: z.number().optional(),
});
export type CyclePrices = z.infer<typeof cyclePricesSchema>;

export const offerSchema = z.object({
  id: z.string(),
  supplier: z.string(),
  name: z.string(),
  segment: z.enum(['Dom', 'Ndom', 'Tod']),
  supply: z.enum(['ELE', 'DUAL']),
  durationMonths: z.number().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  loyalty: z.boolean(),
  indexedPrices: z.boolean(),
  renewable: z.boolean(),
  restrictions: z.boolean(),
  requiredServices: z.boolean(),
  /** Mandatory extra services, €/year with VAT. */
  servicesPerYearWithVat: z.number(),
  /** Discounts for every client. */
  discounts: z.object({
    fixedPerYear: z.number(),
    fixedTermPct: z.number(),
    energyPct: z.number(),
    energyPerKwh: z.number(),
  }),
  /** Discounts only for new clients (shown, not applied). */
  newClientDiscounts: z.object({
    fixedPerYearWithVat: z.number(),
    fixedTermPct: z.number(),
    energyPct: z.number(),
    energyPerKwh: z.number(),
  }),
  payment: z.object({ directDebit: z.boolean(), multibanco: z.boolean(), cash: z.boolean() }),
  billing: z.object({ electronic: z.boolean(), paper: z.boolean() }),
  links: z.object({
    offer: z.string().optional(),
    standardSheet: z.string().optional(),
    generalTerms: z.string().optional(),
  }),
  texts: z.object({
    loyalty: z.string().optional(),
    restrictions: z.string().optional(),
    priceUpdates: z.string().optional(),
  }),
  /** By contracted power (kVA, as "6.9") and cycle code. */
  prices: z.record(z.string(), z.partialRecord(cycleCodeSchema, cyclePricesSchema)),
});
export type Offer = z.infer<typeof offerSchema>;

export const offersFileSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string(),
  /** ERSE update date (from the file name), ISO. */
  dataDate: z.string(),
  fetchedAt: z.string(),
  offers: z.array(offerSchema),
});
export type OffersFile = z.infer<typeof offersFileSchema>;

/** "6,90" / 6.9 → "6.9" (key of Offer.prices). */
export function powerKey(kva: number): string {
  return String(Math.round(kva * 100) / 100);
}
