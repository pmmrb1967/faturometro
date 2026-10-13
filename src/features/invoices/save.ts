/**
 * Saves a reviewed invoice: provider (by NIF), contract (existing or new),
 * original file (once per file) and the invoice itself.
 */
import type { Repositories } from '../../db/repositories';
import type { Contract, Invoice, Provider, Sector, Source } from '../../domain/types';
import type { Cents } from '../../lib/money';

export interface InvoiceDraft {
  file?: { fileHash: string; mime: string; bytes: Uint8Array<ArrayBuffer> };
  /** Hash of the file, or of the manual entry when there is no file. */
  fileHash: string;
  issuerNif: string;
  providerName: string;
  sector: Sector;
  contract: { id: string } | { label: string; customerNumber?: string };
  docType: string;
  docId?: string;
  atcud?: string;
  docKey?: string;
  issueDate: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  totalCents: Cents;
  vatCents?: Cents;
  qrStatus: Invoice['qrStatus'];
  /** Where each field came from (QR, manual…). */
  sources: Partial<Record<string, Source>>;
}

export class DuplicateInvoiceError extends Error {
  readonly invoiceId: string;

  constructor(invoiceId: string) {
    super('Invoice already stored');
    this.name = 'DuplicateInvoiceError';
    this.invoiceId = invoiceId;
  }
}

export async function findProviderByNif(
  repos: Repositories,
  nif: string,
): Promise<Provider | undefined> {
  return (await repos.providers.findBy('nif', nif))[0];
}

export async function saveInvoice(
  repos: Repositories,
  draft: InvoiceDraft,
  options: { keepOriginalFile: boolean },
): Promise<Invoice> {
  const now = new Date().toISOString();

  // Check before creating anything, so a duplicate leaves no orphan provider/contract.
  if (draft.docKey) {
    const existing = (await repos.invoices.findBy('docKey', draft.docKey))[0];
    if (existing) throw new DuplicateInvoiceError(existing.id);
  }

  let provider = await findProviderByNif(repos, draft.issuerNif);
  if (!provider) {
    provider = await repos.providers.put({
      id: crypto.randomUUID(),
      nif: draft.issuerNif,
      name: draft.providerName.trim(),
      sectors: [draft.sector],
    });
  } else if (!provider.sectors.includes(draft.sector)) {
    provider = await repos.providers.put({
      ...provider,
      sectors: [...provider.sectors, draft.sector],
    });
  }

  let contract: Contract | undefined;
  if ('id' in draft.contract) {
    contract = await repos.contracts.get(draft.contract.id);
    if (!contract) throw new Error('Contract not found');
  } else {
    const newContract: Omit<Contract, 'updatedAt'> = {
      id: crypto.randomUUID(),
      providerId: provider.id,
      sector: draft.sector,
      label: draft.contract.label.trim(),
      active: true,
      createdAt: now,
    };
    if (draft.contract.customerNumber?.trim()) {
      newContract.customerNumber = draft.contract.customerNumber.trim();
    }
    contract = await repos.contracts.put(newContract);
  }

  if (draft.file && options.keepOriginalFile) await repos.documents.put(draft.file);

  const invoice: Omit<Invoice, 'updatedAt'> = {
    id: crypto.randomUUID(),
    contractId: contract.id,
    providerId: provider.id,
    fileHash: draft.fileHash,
    docType: draft.docType,
    issueDate: draft.issueDate,
    totalCents: draft.totalCents,
    qrStatus: draft.qrStatus,
    // Cross-validation (step 5) arrives with the parsers in phase 2.
    validation: 'not_checked',
    sources: draft.sources,
    confidence: {},
    createdAt: now,
  };
  const optional = ['docId', 'atcud', 'docKey', 'periodStart', 'periodEnd', 'dueDate'] as const;
  for (const field of optional) {
    const value = draft[field];
    if (value) invoice[field] = value;
  }
  if (draft.vatCents !== undefined) invoice.vatCents = draft.vatCents;
  return repos.invoices.put(invoice);
}
