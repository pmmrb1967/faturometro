/**
 * Gas comparator and electricity + gas together (spec 2026-10-14): annual
 * kWh from the user's invoices, current cost from the latest gas invoice,
 * and the estimated annual cost of every valid ERSE gas or dual offer for the
 * contract's escalão. "Estimativa", never "poupança garantida".
 */
import type { AnnualUsage, Comparison, OfferResult } from './compare';
import { periodDays } from './contract-prices';
import type { CycleCode, Escalao, GasPrices, Offer, RegulatedGas } from './erse';
import { estimateGasCost, gasBreakdownFromLines, type GasOfferPrices } from './gas-cost';
import type { InvoiceLine } from './types';

const YEAR = 365;

/**
 * Whether ERSE gas fixed terms (TFGN) include the network fixed term.
 * Assumed, to confirm with a newer invoice: docs/gas-vat.md.
 */
export const ERSE_GAS_FIXED_INCLUDES_NETWORK = true;

export interface GasOfferResult {
  offer: Offer;
  annualCents: number;
  /** Positive = cheaper than the current contract. */
  savingCents: number;
}

export interface GasComparison {
  usage: AnnualUsage;
  currentAnnualCents: number;
  /** GN and DUAL offers with prices for the escalão, cheapest first. */
  results: GasOfferResult[];
  regulated?: { code: string; name: string; annualCents: number };
}

export interface CompareGasInput {
  offers: Offer[];
  regulated: RegulatedGas;
  latest: { lines: InvoiceLine[]; periodStart: string; periodEnd: string };
  usage: AnnualUsage;
  escalao: Escalao;
  /** ERSE ORD code, 'unknown' or undefined. */
  distributor?: string;
  today: string;
}

function offerGasPrices(offer: Offer, prices: GasPrices): GasOfferPrices {
  // Yearly discounts and mandatory services belong to the electricity part of a dual offer.
  const gasOnly = offer.supply === 'GN';
  return {
    fixedPerDay: prices.fixedPerDay,
    perKwh: prices.perKwh,
    fixedTermDiscountPct: offer.gasDiscounts.fixedTermPct,
    energyDiscountPct: offer.gasDiscounts.energyPct,
    energyDiscountPerKwh: offer.gasDiscounts.energyPerKwh,
    discountPerYear: gasOnly ? offer.discounts.fixedPerYear : 0,
    servicesPerYearWithVat: gasOnly ? offer.servicesPerYearWithVat : 0,
    fixedIncludesNetwork: ERSE_GAS_FIXED_INCLUDES_NETWORK,
  };
}

const isValid = (offer: Offer, today: string) =>
  !(offer.validFrom && offer.validFrom > today) && !(offer.validTo && offer.validTo < today);

export function compareGas(input: CompareGasInput): GasComparison | null {
  const breakdown = gasBreakdownFromLines(
    input.latest.lines,
    periodDays(input.latest.periodStart, input.latest.periodEnd),
  );
  if (!breakdown) return null;
  const kwh = input.usage.total;
  const current = estimateGasCost(breakdown.prices, kwh, YEAR, breakdown.common);

  const results: GasOfferResult[] = [];
  for (const offer of input.offers) {
    if (offer.supply === 'ELE' || !isValid(offer, input.today)) continue;
    const prices = offer.gasPrices[input.escalao];
    if (!prices) continue;
    const estimate = estimateGasCost(offerGasPrices(offer, prices), kwh, YEAR, breakdown.common);
    results.push({
      offer,
      annualCents: estimate.totalCents,
      savingCents: current.totalCents - estimate.totalCents,
    });
  }
  results.sort((a, b) => a.annualCents - b.annualCents);

  const comparison: GasComparison = {
    usage: input.usage,
    currentAnnualCents: current.totalCents,
    results,
  };
  const regulated = input.distributor ? input.regulated[input.distributor] : undefined;
  const regulatedPrices = regulated?.prices[input.escalao];
  if (regulated && regulatedPrices && input.distributor) {
    comparison.regulated = {
      code: input.distributor,
      name: regulated.name,
      annualCents: estimateGasCost(
        { ...regulatedPrices, fixedIncludesNetwork: ERSE_GAS_FIXED_INCLUDES_NETWORK },
        kwh,
        YEAR,
        breakdown.common,
      ).totalCents,
    };
  }
  return comparison;
}

export interface DualResult {
  offer: Offer;
  cycle: CycleCode;
  annualCents: number;
  savingCents: number;
}

export interface BothComparison {
  currentAnnualCents: number;
  /** Best electricity-only offer + best gas-only offer (suppliers may differ). */
  bestSeparate?: {
    electricity: OfferResult;
    gas: GasOfferResult;
    annualCents: number;
    savingCents: number;
  };
  /** Dual offers priced with both parts, cheapest first. */
  duals: DualResult[];
}

export function combineElectricityGas(electricity: Comparison, gas: GasComparison): BothComparison {
  const currentAnnualCents = electricity.currentAnnualCents + gas.currentAnnualCents;
  const both: BothComparison = { currentAnnualCents, duals: [] };

  const bestElectricity = electricity.results.find((item) => item.offer.supply === 'ELE');
  const bestGas = gas.results.find((item) => item.offer.supply === 'GN');
  if (bestElectricity && bestGas) {
    const annualCents = bestElectricity.annualCents + bestGas.annualCents;
    both.bestSeparate = {
      electricity: bestElectricity,
      gas: bestGas,
      annualCents,
      savingCents: currentAnnualCents - annualCents,
    };
  }

  // A dual offer only counts when it has a gas price for the escalão.
  const gasById = new Map(
    gas.results.filter((item) => item.offer.supply === 'DUAL').map((item) => [item.offer.id, item]),
  );
  const seen = new Set<string>();
  // Electricity results are sorted: the first one of an offer is its cheapest cycle.
  for (const item of electricity.results) {
    if (item.offer.supply !== 'DUAL' || seen.has(item.offer.id)) continue;
    const gasPart = gasById.get(item.offer.id);
    if (!gasPart) continue;
    seen.add(item.offer.id);
    const annualCents = item.annualCents + gasPart.annualCents;
    both.duals.push({
      offer: item.offer,
      cycle: item.cycle,
      annualCents,
      savingCents: currentAnnualCents - annualCents,
    });
  }
  both.duals.sort((a, b) => a.annualCents - b.annualCents);
  return both;
}
