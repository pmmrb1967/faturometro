/**
 * Insurance: compare proposals from other insurers with the current policy,
 * coverage by coverage (PLAN.md §15, "comparar propostas recebidas"). The user
 * types each proposal from what the insurer sent; nothing leaves the device.
 * Facts only: what is missing, lower or higher, and the price difference.
 */
import { parsePtAmount, type Cents } from '../lib/money';
import type {
  InsuranceCoverage,
  InsuranceDetails,
  InsuranceProposal,
  ProposalCoverage,
} from './types';

export type CoverageVerdict =
  /** The proposal does not include it. */
  | 'missing'
  /** Insured capital below the current one. */
  | 'lower_capital'
  /** Deductible above the current one. */
  | 'higher_deductible'
  /** Nothing worse found in what can be compared. */
  | 'ok';

export interface CoverageComparison {
  name: string;
  verdicts: CoverageVerdict[];
  current: Pick<InsuranceCoverage, 'capital' | 'capitalCents' | 'deductible'>;
  proposed?: ProposalCoverage;
}

export interface ProposalComparison {
  proposal: InsuranceProposal;
  /** Proposal minus the current annual premium; undefined without the current premium. */
  premiumDifferenceCents?: Cents;
  coverages: CoverageComparison[];
  /** How many coverages are missing or worse. */
  worse: number;
}

/** "250,00 €" → cents; texts like "10 % mín. 250 €" or "Não aplicável" are not compared. */
export function deductibleCents(text: string | undefined): Cents | undefined {
  if (!text) return undefined;
  const cents = parsePtAmount(text.replace(/\s/g, ' ').trim());
  return cents === null ? undefined : cents;
}

/** The current annual premium: from the particular conditions, else the renewal letter. */
export function currentPremiumCents(insurance: InsuranceDetails | undefined): Cents | undefined {
  return insurance?.annualPremiumCents ?? insurance?.renewal?.nextCents;
}

export function compareProposal(
  insurance: InsuranceDetails,
  proposal: InsuranceProposal,
): ProposalComparison {
  const byName = new Map(proposal.coverages.map((coverage) => [coverage.name, coverage]));
  const coverages = (insurance.coverages ?? []).map((coverage): CoverageComparison => {
    const proposed = byName.get(coverage.name);
    const verdicts: CoverageVerdict[] = [];
    if (!proposed?.included) {
      verdicts.push('missing');
    } else {
      if (
        coverage.capitalCents !== undefined &&
        proposed.capitalCents !== undefined &&
        proposed.capitalCents < coverage.capitalCents
      ) {
        verdicts.push('lower_capital');
      }
      const current = deductibleCents(coverage.deductible);
      if (
        current !== undefined &&
        proposed.deductibleCents !== undefined &&
        proposed.deductibleCents > current
      ) {
        verdicts.push('higher_deductible');
      }
      if (verdicts.length === 0) verdicts.push('ok');
    }
    return {
      name: coverage.name,
      verdicts,
      current: {
        ...(coverage.capital !== undefined ? { capital: coverage.capital } : {}),
        ...(coverage.capitalCents !== undefined ? { capitalCents: coverage.capitalCents } : {}),
        ...(coverage.deductible !== undefined ? { deductible: coverage.deductible } : {}),
      },
      ...(proposed ? { proposed } : {}),
    };
  });
  const premium = currentPremiumCents(insurance);
  return {
    proposal,
    ...(premium !== undefined
      ? { premiumDifferenceCents: proposal.annualPremiumCents - premium }
      : {}),
    coverages,
    worse: coverages.filter((coverage) => !coverage.verdicts.includes('ok')).length,
  };
}

/** Plain-text summary of the policy, to fill in insurers' online simulators by hand. */
export function coverageSummary(
  insurance: InsuranceDetails,
  labels: { capital: string; deductible: string; premium: (amount: string) => string },
  formatAmount: (cents: Cents) => string,
): string {
  const lines = [
    [insurance.product, insurance.option].filter(Boolean).join(' — '),
    insurance.insuredObject,
  ].filter((line): line is string => Boolean(line));
  const premium = currentPremiumCents(insurance);
  if (premium !== undefined) lines.push(labels.premium(formatAmount(premium)));
  for (const coverage of insurance.coverages ?? []) {
    const parts = [
      coverage.capital && `${labels.capital}: ${coverage.capital}`,
      coverage.deductible && `${labels.deductible}: ${coverage.deductible}`,
    ].filter(Boolean);
    lines.push(`- ${coverage.name}${parts.length > 0 ? ` (${parts.join('; ')})` : ''}`);
  }
  return lines.join('\n');
}
