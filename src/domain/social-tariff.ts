/**
 * "Tenho direito à tarifa social?" Pure check of the official criteria against
 * what the user answers (never stored) and the contracts in the app.
 *
 * Reference data, updated yearly (CLAUDE.md rule 6; keep the sources):
 * - Electricity and natural gas: ERSE leaflet "Tarifa social" (October 2026),
 *   https://www.erse.pt/media/xvtbbuq4/tarifa-social_eletricidade_gas_out2026_pt.pdf
 * - Internet: ANACOM consumer portal, "Tarifa Social de Internet (TSI)" (read 2026-10-18),
 *   https://www.anacom-consumidor.pt/faq-tarifa-social-de-internet-tsi
 */
import type { Cents } from '../lib/money';
import type { Contract } from './types';

export const SOCIAL_TARIFF_SOURCES = {
  energy: 'https://www.erse.pt/media/xvtbbuq4/tarifa-social_eletricidade_gas_out2026_pt.pdf',
  internet: 'https://www.anacom-consumidor.pt/faq-tarifa-social-de-internet-tsi',
  // Linked from the ERSE leaflet.
  dgeg: 'https://www.dgeg.gov.pt/pt/areas-transversais/politicas-de-protecao-ao-consumidor-de-energia/tarifa-social-de-energia/',
} as const;

/** Social benefits named in the criteria. The family allowance counts by tier for gas. */
export const BENEFITS = [
  'csi',
  'rsi',
  'unemployment',
  'family_allowance_1',
  'family_allowance_other',
  'invalidity',
  'old_age',
] as const;
export type Benefit = (typeof BENEFITS)[number];

export type SocialTariffService = 'electricity' | 'gas' | 'internet';

interface Rule {
  benefits: readonly Benefit[];
  /** Yearly household income limit, before the increase per member without income. */
  incomeLimitCents?: Cents;
}

const RULES: Record<SocialTariffService, Rule> = {
  // ERSE, October 2026: benefits a) to f), or income up to 6 272,64 €.
  electricity: {
    benefits: [
      'csi',
      'rsi',
      'unemployment',
      'family_allowance_1',
      'family_allowance_other',
      'invalidity',
      'old_age',
    ],
    incomeLimitCents: 627264,
  },
  // ERSE, October 2026: benefits a) to e), family allowance only in the 1st tier; no income criterion.
  gas: { benefits: ['csi', 'rsi', 'unemployment', 'family_allowance_1', 'invalidity'] },
  // ANACOM: the same benefits as electricity, or income up to 5 808 €.
  internet: {
    benefits: [
      'csi',
      'rsi',
      'unemployment',
      'family_allowance_1',
      'family_allowance_other',
      'invalidity',
      'old_age',
    ],
    incomeLimitCents: 580800,
  },
};

/** Electricity: contracted power up to 6,9 kVA (ERSE). */
export const MAX_POWER_KVA = 6.9;
/** Gas: up to 500 m³ a year, "which includes the 1st and 2nd consumption tiers" (ERSE). */
export const MAX_GAS_ESCALAO = 2;
/** The income limit grows 50 % per member without income, the applicant included, up to 10. */
const MAX_MEMBERS = 10;
/** Internet social tariff price (ANACOM): 5 € + VAT a month; activation up to 21,45 € + VAT. */
export const INTERNET_PRICE_CENTS = 500;
export const INTERNET_ACTIVATION_MAX_CENTS = 2145;

export interface SocialTariffAnswers {
  benefits: readonly Benefit[];
  /** Household's yearly income; undefined when the user did not say. */
  annualIncomeCents?: Cents;
  /** Members of the household without any income, the applicant included. */
  membersWithoutIncome: number;
}

export type ContractNote =
  /** The invoice already shows the social tariff discount. */
  | 'already'
  /** Contracted power above 6,9 kVA. */
  | 'power_too_high'
  /** Gas consumption tier above the 2nd. */
  | 'gas_tier_too_high';

export interface ServiceCheck {
  service: SocialTariffService;
  /** By the answers: a benefit or the income gives the right; otherwise not (or unknown). */
  eligible: boolean;
  reason?: 'benefit' | 'income';
  /** Income limit for this household, when the service has an income criterion. */
  incomeLimitCents?: Cents;
  /** What the contracts in the app say, when they have that service. */
  contractNotes: ContractNote[];
}

export function incomeLimit(baseCents: Cents, membersWithoutIncome: number): Cents {
  const members = Math.min(Math.max(Math.trunc(membersWithoutIncome), 0), MAX_MEMBERS);
  return Math.round(baseCents * (1 + members / 2));
}

function notesFor(service: SocialTariffService, contracts: readonly Contract[]): ContractNote[] {
  const notes = new Set<ContractNote>();
  for (const contract of contracts.filter((candidate) => candidate.active)) {
    if (service === 'electricity' && contract.electricity) {
      if (contract.electricity.socialTariff) notes.add('already');
      if (contract.electricity.powerKva > MAX_POWER_KVA) notes.add('power_too_high');
    }
    if (service === 'gas' && contract.gas?.escalao && contract.gas.escalao > MAX_GAS_ESCALAO) {
      notes.add('gas_tier_too_high');
    }
  }
  return [...notes];
}

export function checkSocialTariff(
  answers: SocialTariffAnswers,
  contracts: readonly Contract[] = [],
): ServiceCheck[] {
  return (['electricity', 'gas', 'internet'] as const).map((service) => {
    const rule = RULES[service];
    const check: ServiceCheck = {
      service,
      eligible: false,
      contractNotes: notesFor(service, contracts),
    };
    if (rule.incomeLimitCents !== undefined) {
      check.incomeLimitCents = incomeLimit(rule.incomeLimitCents, answers.membersWithoutIncome);
    }
    if (answers.benefits.some((benefit) => rule.benefits.includes(benefit))) {
      check.eligible = true;
      check.reason = 'benefit';
    } else if (
      check.incomeLimitCents !== undefined &&
      answers.annualIncomeCents !== undefined &&
      answers.annualIncomeCents <= check.incomeLimitCents
    ) {
      check.eligible = true;
      check.reason = 'income';
    }
    return check;
  });
}
