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
import type { Contract, Invoice, InvoiceLine } from './types';

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

function notesFor(
  service: SocialTariffService,
  contracts: readonly Contract[],
  withSocialTariff: ReadonlySet<string>,
): ContractNote[] {
  const notes = new Set<ContractNote>();
  for (const contract of contracts.filter((candidate) => candidate.active)) {
    if (contract.sector === service && withSocialTariff.has(contract.id)) notes.add('already');
    if (service === 'electricity' && contract.electricity) {
      if (contract.electricity.powerKva > MAX_POWER_KVA) notes.add('power_too_high');
    }
    if (service === 'gas' && contract.gas?.escalao && contract.gas.escalao > MAX_GAS_ESCALAO) {
      notes.add('gas_tier_too_high');
    }
  }
  return [...notes];
}

/**
 * @param withSocialTariff ids of the contracts whose latest invoice shows the
 *   social tariff discount (see {@link socialTariffState}).
 */
export function checkSocialTariff(
  answers: SocialTariffAnswers,
  contracts: readonly Contract[] = [],
  withSocialTariff: ReadonlySet<string> = new Set(),
): ServiceCheck[] {
  return (['electricity', 'gas', 'internet'] as const).map((service) => {
    const rule = RULES[service];
    const check: ServiceCheck = {
      service,
      eligible: false,
      contractNotes: notesFor(service, contracts, withSocialTariff),
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

/**
 * A social tariff discount on an energy invoice (Repsol: "Desc. Social Redes
 * Energia"). The "Financ. T. Social" charge that every customer pays to fund
 * the tariff is not a discount, so it does not count.
 */
export function isSocialDiscount(line: Pick<InvoiceLine, 'kind' | 'description'>): boolean {
  return line.kind === 'discount' && /social/i.test(line.description);
}

/** What the social tariff took off an invoice, in positive cents (0 when none). */
export function socialDiscountCents(lines: readonly InvoiceLine[]): Cents {
  const sum = lines.filter(isSocialDiscount).reduce((total, line) => total + line.amountCents, 0);
  return sum < 0 ? -sum : 0;
}

export type SocialTariffState =
  | { state: 'active'; invoice: Invoice; discountCents: Cents }
  /** The previous invoice had the discount and the latest one does not. */
  | { state: 'lost'; invoice: Invoice; previous: Invoice; previousDiscountCents: Cents };

/**
 * Social tariff of an electricity or gas contract, from its two latest
 * invoices with lines (invoices typed by hand without lines say nothing).
 */
export function socialTariffState(
  contract: Pick<Contract, 'sector'>,
  history: readonly Invoice[],
  linesOf: (invoice: Invoice) => readonly InvoiceLine[],
): SocialTariffState | null {
  if (contract.sector !== 'electricity' && contract.sector !== 'gas') return null;
  const withLines = history
    .filter((invoice) => linesOf(invoice).length > 0)
    .sort(
      (a, b) => a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt),
    );
  const invoice = withLines.at(-1);
  if (!invoice) return null;
  const discountCents = socialDiscountCents(linesOf(invoice));
  if (discountCents > 0) return { state: 'active', invoice, discountCents };
  const previous = withLines.at(-2);
  const previousDiscountCents = previous ? socialDiscountCents(linesOf(previous)) : 0;
  return previous && previousDiscountCents > 0
    ? { state: 'lost', invoice, previous, previousDiscountCents }
    : null;
}

/** Ids of the contracts whose latest invoice shows the social tariff discount. */
export function contractsWithSocialTariff(
  contracts: readonly Contract[],
  invoices: readonly Invoice[],
  lines: readonly InvoiceLine[],
): Set<string> {
  const linesByInvoice = linesByInvoiceId(lines);
  const linesOf = (invoice: Invoice) => linesByInvoice.get(invoice.id) ?? [];
  return new Set(
    contracts
      .filter((contract) => {
        const history = invoices.filter((invoice) => invoice.contractId === contract.id);
        return socialTariffState(contract, history, linesOf)?.state === 'active';
      })
      .map((contract) => contract.id),
  );
}

export function linesByInvoiceId(lines: readonly InvoiceLine[]): Map<string, InvoiceLine[]> {
  const byInvoice = new Map<string, InvoiceLine[]>();
  for (const line of lines) {
    const own = byInvoice.get(line.invoiceId);
    if (own) own.push(line);
    else byInvoice.set(line.invoiceId, [line]);
  }
  return byInvoice;
}

/**
 * Water: no national social tariff. Under Decreto-Lei n.º 147/2017 each
 * municipality chooses whether to have one and how it is asked for (e.g.
 * Trofa, Aviso n.º 18662/2023: request with IRS or proof of the benefit,
 * renewed every year). Read 2026-10-18.
 */
export const WATER_SOCIAL_TARIFF_SOURCE =
  'https://diariodarepublica.pt/dr/detalhe/decreto-lei/147-2017-114303791';

/**
 * Energy: Decreto-Lei n.º 138-A/2010 (electricity) and n.º 101/2011 (natural
 * gas); DGEG contacts as on its page (read 2026-10-18).
 */
export const DGEG_CONTACT = { phone: '210 308 536' } as const;

export type SocialTariffSuggestion =
  /** Gas has it and electricity does not: whoever qualifies for gas qualifies for electricity. */
  | 'electricity_missing'
  /** Electricity has it and gas does not: possible, the gas criteria are narrower. */
  | 'gas_missing'
  /** Energy has it: the internet social tariff (asked for, not automatic) may apply. */
  | 'internet'
  /** Energy has it: the water one depends on the municipality. */
  | 'water';

/**
 * Contracts that may also have a social tariff, given the ones that show it
 * (ERSE leaflet, October 2026; ANACOM; Decreto-Lei 147/2017). The app does not
 * know who holds each contract: the texts say it only applies to the holder.
 */
export function socialTariffSuggestions(
  contracts: readonly Contract[],
  withSocialTariff: ReadonlySet<string>,
): { contractId: string; suggestion: SocialTariffSuggestion }[] {
  const active = contracts.filter((contract) => contract.active);
  const has = (sector: Contract['sector']) =>
    active.some((contract) => contract.sector === sector && withSocialTariff.has(contract.id));
  const without = (sector: Contract['sector']) =>
    active.filter((contract) => contract.sector === sector && !withSocialTariff.has(contract.id));
  const energy = has('electricity') || has('gas');
  const result: { contractId: string; suggestion: SocialTariffSuggestion }[] = [];

  if (has('gas')) {
    for (const contract of without('electricity')) {
      if ((contract.electricity?.powerKva ?? 0) > MAX_POWER_KVA) continue;
      result.push({ contractId: contract.id, suggestion: 'electricity_missing' });
    }
  }
  if (has('electricity')) {
    for (const contract of without('gas')) {
      if ((contract.gas?.escalao ?? 0) > MAX_GAS_ESCALAO) continue;
      result.push({ contractId: contract.id, suggestion: 'gas_missing' });
    }
  }
  if (energy) {
    // One internet social tariff per household: suggest it on one contract with internet.
    const internet = active.find(
      (contract) =>
        contract.sector === 'telecom' &&
        (!contract.telecom || contract.telecom.services.includes('internet')),
    );
    if (internet) result.push({ contractId: internet.id, suggestion: 'internet' });
    for (const contract of active.filter((candidate) => candidate.sector === 'water')) {
      result.push({ contractId: contract.id, suggestion: 'water' });
    }
  }
  return result;
}
