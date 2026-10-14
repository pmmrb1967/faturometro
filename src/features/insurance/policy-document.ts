/**
 * Applies an insurance document that is not an invoice (renewal letter,
 * particular conditions) to its policy's contract.
 */
import type { Contract, InsuranceDetails } from '../../domain/types';
import type { PolicyDocument } from '../../parsers/policy-documents';

type Candidate = Pick<Contract, 'id' | 'sector' | 'label' | 'insurance'>;

/**
 * The contract the document belongs to: same policy number; else the only
 * insurance contract, if it has no policy number yet (another number is
 * another policy).
 */
export function contractForDocument(
  contracts: readonly Candidate[],
  document: PolicyDocument,
): string {
  const insurance = contracts.filter((contract) => contract.sector === 'insurance');
  if (document.policyNumber) {
    const same = insurance.find(
      (contract) => contract.insurance?.policyNumber === document.policyNumber,
    );
    if (same) return same.id;
  }
  const only = insurance.length === 1 ? insurance[0] : undefined;
  return only && !only.insurance?.policyNumber ? only.id : '';
}

/** The contract's policy data with the document's added (the document's values win). */
export function withPolicyDocument(
  current: InsuranceDetails | undefined,
  document: PolicyDocument,
): InsuranceDetails {
  const next: InsuranceDetails = { ...current };
  if (document.policyNumber && !next.policyNumber) next.policyNumber = document.policyNumber;
  if (document.kind === 'renewal') {
    next.renewal = document.renewal;
    return next;
  }
  const { details } = document;
  if (details.coverages) next.coverages = details.coverages;
  if (details.annualPremiumCents !== undefined)
    next.annualPremiumCents = details.annualPremiumCents;
  if (details.bonusMalusPct !== undefined) next.bonusMalusPct = details.bonusMalusPct;
  // Receipts already say what the product and object are; fill them only when missing.
  if (details.product && !next.product) next.product = details.product;
  if (details.option && !next.option) next.option = details.option;
  if (details.insuredObject && !next.insuredObject) next.insuredObject = details.insuredObject;
  return next;
}
