/**
 * Natural gas cost estimate for a number of days (docs/gas-vat.md):
 *   offer fixed term × days + kWh × price + charges common to every offer + VAT
 * VAT: 6 % on the network access fixed term and discounts on it, 23 % on the
 * rest. Euros as floats while computing; rounded to integer cents once.
 */
import { VAT_NORMAL, VAT_REDUCED, type Estimate } from './electricity-cost';
import type { InvoiceLine } from './types';

export interface GasOfferPrices {
  /** €/day, without VAT. */
  fixedPerDay: number;
  /** €/kWh, without VAT. */
  perKwh: number;
  fixedTermDiscountPct?: number;
  energyDiscountPct?: number;
  energyDiscountPerKwh?: number;
  /** €/year off the bill. */
  discountPerYear?: number;
  /** Mandatory extra services, €/year WITH VAT. */
  servicesPerYearWithVat?: number;
  /** The fixed term already includes the network fixed term (ERSE TFGN, see docs/gas-vat.md). */
  fixedIncludesNetwork?: boolean;
}

/** Charges that do not depend on the offer, read from the user's own gas invoice. */
export interface GasCommonCharges {
  /** Network access fixed term, €/day (VAT 6 %). */
  networkPerDay: number;
  /** Other €/day at 6 % (social discount on the network fixed term). */
  reducedPerDay: number;
  /** €/day at 23 % (fixed land-use fee…). */
  normalPerDay: number;
  /** €/kWh at 23 % (variable land-use fee, excise tax, social discount on energy…). */
  perKwh: number;
}

export const NO_GAS_COMMON_CHARGES: GasCommonCharges = {
  networkPerDay: 0,
  reducedPerDay: 0,
  normalPerDay: 0,
  perKwh: 0,
};

export function estimateGasCost(
  prices: GasOfferPrices,
  kwh: number,
  days: number,
  common: GasCommonCharges = NO_GAS_COMMON_CHARGES,
): Estimate {
  let energy = kwh * prices.perKwh * (1 - (prices.energyDiscountPct ?? 0) / 100);
  energy -= (prices.energyDiscountPerKwh ?? 0) * kwh;
  energy += common.perKwh * kwh;

  const network = common.networkPerDay * days;
  const offerFixed = prices.fixedPerDay * days * (1 - (prices.fixedTermDiscountPct ?? 0) / 100);
  // When the offer's fixed term already contains the network part, that part moves to 6 %.
  const fixedNormal =
    (prices.fixedIncludesNetwork ? offerFixed - network : offerFixed) +
    common.normalPerDay * days -
    ((prices.discountPerYear ?? 0) * days) / 365;
  const fixedReduced = network + common.reducedPerDay * days;

  const net = energy + fixedNormal + fixedReduced;
  const vat = (energy + fixedNormal) * VAT_NORMAL + fixedReduced * VAT_REDUCED;
  const services = ((prices.servicesPerYearWithVat ?? 0) * days) / 365;
  const netCents = Math.round(net * 100);
  const vatCents = Math.round(vat * 100);
  return {
    netCents,
    vatCents,
    totalCents: netCents + vatCents + Math.round(services * 100),
    reducedKwh: 0,
  };
}

type GasLine = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice'
>;

export interface GasBreakdown {
  /** The current contract's prices (fixed term without the network part). */
  prices: GasOfferPrices;
  common: GasCommonCharges;
  kwh: number;
}

const SOCIAL = /social/i;
const NETWORK = /redes/i;
const FIXED_TERM = /termo fixo/i;
const FIXED_FEE = /fixa/i;

/**
 * The invoice settles earlier estimates (energy lines without a unit price):
 * its discounts and taxes then include amounts of other periods, so it is not
 * a good source of per-day and per-kWh charges.
 */
export function hasEarlierAdjustments(lines: readonly GasLine[]): boolean {
  return lines.some((line) => line.kind === 'energy' && line.unitPrice === undefined);
}

/** null when the invoice has no priced energy in kWh (e.g. only m³, or no parser). */
export function gasBreakdownFromLines(
  lines: readonly GasLine[],
  days: number,
): GasBreakdown | null {
  const energy = lines.filter(
    (line) =>
      line.kind === 'energy' &&
      line.unit === 'kWh' &&
      line.unitPrice !== undefined &&
      (line.quantity ?? 0) > 0,
  );
  if (energy.length === 0 || days <= 0) return null;
  const kwh = energy.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const energyGross = energy.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * Number(line.unitPrice),
    0,
  );

  const fixed = lines.filter(
    (line) =>
      line.kind === 'power' &&
      line.unit === 'day' &&
      Number(line.unitPrice) > 0 &&
      !NETWORK.test(line.description) &&
      !SOCIAL.test(line.description),
  );
  const network = lines.filter(
    (line) => line.kind === 'power' && NETWORK.test(line.description) && line.amountCents > 0,
  );
  const offerDiscounts = lines.filter(
    (line) => line.kind === 'discount' && !SOCIAL.test(line.description),
  );

  const prices: GasOfferPrices = {
    fixedPerDay: fixed.reduce((sum, line) => sum + Number(line.unitPrice), 0),
    perKwh: energyGross / kwh,
  };
  const discount = -offerDiscounts.reduce((sum, line) => sum + line.amountCents, 0) / 100;
  if (discount > 0 && energyGross > 0) prices.energyDiscountPct = (discount / energyGross) * 100;

  const common: GasCommonCharges = {
    // From the amounts (the €/day shown is rounded; the amount is what was billed).
    networkPerDay: network.reduce((sum, line) => sum + line.amountCents, 0) / 100 / days,
    reducedPerDay: 0,
    normalPerDay: 0,
    perKwh: 0,
  };
  const handled = new Set<GasLine>([...energy, ...fixed, ...network, ...offerDiscounts]);
  for (const line of lines) {
    if (handled.has(line)) continue;
    if (line.kind === 'energy' && line.unitPrice === undefined) continue; // adjustments of earlier periods
    const euros = line.amountCents / 100;
    if (SOCIAL.test(line.description) && FIXED_TERM.test(line.description)) {
      common.reducedPerDay += euros / days;
    } else if (line.kind === 'tax' && FIXED_FEE.test(line.description)) {
      common.normalPerDay += euros / days;
    } else if (line.kind === 'tax' || line.kind === 'discount' || line.unit === 'kWh') {
      common.perKwh += euros / kwh;
    } else {
      common.normalPerDay += euros / days;
    }
  }
  return { prices, common, kwh };
}
