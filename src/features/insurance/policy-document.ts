/**
 * Applies an insurance document that is not an invoice (renewal letter,
 * particular conditions) to its policy's contract.
 */
import type { Contract, InsuranceDetails } from '../../domain/types';
import type { PolicyDocument } from '../../parsers/policy-documents';

type Candidate = Pick<Contract, 'id' | 'sector' | 'label' | 'insurance'>;

/** "0596735" and "596735" are the same policy (documents print leading zeros differently). */
export function samePolicy(a?: string, b?: string): boolean {
  const key = (value?: string) => value?.replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  return Boolean(a && b && key(a) === key(b));
}

/** Choice that saves the document into a new contract. */
export const NEW_CONTRACT = 'new-contract';

/**
 * The contract the document belongs to: same policy number; else the only
 * insurance contract, if it has no policy number yet (another number is
 * another policy, so a new contract, as when there is no insurance yet).
 */
export function contractForDocument(
  contracts: readonly Candidate[],
  document: PolicyDocument,
): string {
  const insurance = contracts.filter((contract) => contract.sector === 'insurance');
  if (document.policyNumber) {
    const same = insurance.find((contract) =>
      samePolicy(contract.insurance?.policyNumber, document.policyNumber),
    );
    if (same) return same.id;
  }
  const only = insurance.length === 1 ? insurance[0] : undefined;
  if (only && !only.insurance?.policyNumber) return only.id;
  return document.policyNumber || insurance.length === 0 ? NEW_CONTRACT : '';
}

/** A new insurance contract made from the document alone (receipts come later). */
export function contractFromDocument(
  document: PolicyDocument,
  ids: { id: string; providerId: string; label: string; now: string },
): Omit<Contract, 'updatedAt'> {
  return {
    id: ids.id,
    providerId: ids.providerId,
    sector: 'insurance',
    label: ids.label,
    insurance: withPolicyDocument(undefined, document),
    active: true,
    createdAt: ids.now,
  };
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
  if (details.startDate) next.startDate = details.startDate;
  if (details.insuredPersons !== undefined) next.insuredPersons = details.insuredPersons;
  // Receipts already say what the product and object are; fill them only when missing.
  if (details.product && !next.product) next.product = details.product;
  if (details.option && !next.option) next.option = details.option;
  if (details.insuredObject && !next.insuredObject) next.insuredObject = details.insuredObject;
  return next;
}
