/**
 * Electricity cost estimate (PLAN.md §8) for a number of days:
 *   fixed term × days + Σ kWh × price + charges common to every offer + VAT
 * VAT rules: docs/electricity-vat.md (ERSE, Lei n.º 38/2024). All amounts in
 * euros as floats while computing (prices have 4–6 decimals); the result is
 * rounded to integer cents once, at the end.
 */
export const VAT_NORMAL = 0.23;
export const VAT_REDUCED = 0.06;
/** kWh per 30 days taxed at the reduced rate (≤ 6,9 kVA); 300 for large families. */
const REDUCED_KWH_PER_30_DAYS = 200;
const REDUCED_KWH_LARGE_FAMILY = 300;
const MAX_KVA_REDUCED_ENERGY = 6.9;

/** kWh in the period being estimated, by tariff period. */
export type Consumption = Partial<
  Record<'simple' | 'offEmpty' | 'empty' | 'peak' | 'full', number>
>;

export interface Prices {
  /** €/day, without VAT. */
  fixedPerDay: number;
  /** €/kWh by tariff period, without VAT. */
  energy: Consumption;
  /** Commercial discounts of the offer (percent of the fixed term / energy, €/kWh, €/year). */
  fixedTermDiscountPct?: number;
  energyDiscountPct?: number;
  energyDiscountPerKwh?: number;
  discountPerYear?: number;
  /** Mandatory extra services, €/year WITH VAT. */
  servicesPerYearWithVat?: number;
}

/**
 * Charges that do not depend on the offer (taxes, social tariff discount,
 * tariff-social financing…), read from the user's own invoices.
 */
export interface CommonCharges {
  /** €/kWh (e.g. social discount on energy, tariff-social financing, IEC): VAT like energy. */
  perKwh: number;
  /** €/day taxed at 6 % (CAV). */
  reducedPerDay: number;
  /** €/day taxed at 23 % (DGEG fee, social discount on power…). */
  normalPerDay: number;
}

export interface Household {
  powerKva: number;
  largeFamily?: boolean;
}

export interface Estimate {
  netCents: number;
  vatCents: number;
  totalCents: number;
  /** kWh taxed at the reduced rate. */
  reducedKwh: number;
}

export const NO_COMMON_CHARGES: CommonCharges = { perKwh: 0, reducedPerDay: 0, normalPerDay: 0 };

function totalKwh(consumption: Consumption): number {
  return Object.values(consumption).reduce((sum, value) => sum + (value ?? 0), 0);
}

/** Share of the energy taxed at 6 % in a period of `days` days. */
export function reducedShare(kwh: number, days: number, household: Household): number {
  if (household.powerKva > MAX_KVA_REDUCED_ENERGY || kwh <= 0) return 0;
  const limit = household.largeFamily ? REDUCED_KWH_LARGE_FAMILY : REDUCED_KWH_PER_30_DAYS;
  return Math.min(1, Math.round((days / 30) * limit) / kwh);
}

export function estimateCost(
  prices: Prices,
  consumption: Consumption,
  days: number,
  household: Household,
  common: CommonCharges = NO_COMMON_CHARGES,
): Estimate {
  const kwh = totalKwh(consumption);
  const share = reducedShare(kwh, days, household);
  const energyVat = share * VAT_REDUCED + (1 - share) * VAT_NORMAL;

  let energy = 0;
  for (const [period, quantity] of Object.entries(consumption) as [keyof Consumption, number][]) {
    const price = prices.energy[period];
    if (price === undefined && quantity > 0) throw new Error(`No price for ${period}`);
    energy += quantity * (price ?? 0);
  }
  energy *= 1 - (prices.energyDiscountPct ?? 0) / 100;
  energy -= (prices.energyDiscountPerKwh ?? 0) * kwh;
  energy += common.perKwh * kwh;

  // Fixed term at 23 % (for ≤ 3,45 kVA the access-tariff part would be 6 %, but
  // offers do not separate it: docs/electricity-vat.md).
  const fixed =
    prices.fixedPerDay * days * (1 - (prices.fixedTermDiscountPct ?? 0) / 100) +
    common.normalPerDay * days -
    ((prices.discountPerYear ?? 0) * days) / 365;
  const reduced = common.reducedPerDay * days;

  const net = energy + fixed + reduced;
  const vat = energy * energyVat + fixed * VAT_NORMAL + reduced * VAT_REDUCED;
  const services = ((prices.servicesPerYearWithVat ?? 0) * days) / 365;
  const netCents = Math.round(net * 100);
  const vatCents = Math.round(vat * 100);
  return {
    netCents,
    vatCents,
    totalCents: netCents + vatCents + Math.round(services * 100),
    reducedKwh: share * kwh,
  };
}
