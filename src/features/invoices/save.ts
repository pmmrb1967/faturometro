/**
 * Saves a reviewed invoice: provider (by NIF), contract (existing or new),
 * original file (once per file) and the invoice itself.
 */
import type { Repositories } from '../../db/repositories';
import type { Contract, Invoice, Provider, Sector, Source } from '../../domain/types';
import type { ExtractedLine, ExtractedReading } from '../../parsers/types';
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
  /** Where each field came from (QR, parser, manual…). */
  sources: Partial<Record<string, Source>>;
  /** From a layout parser (steps 4–5). */
  lines?: ExtractedLine[];
  readings?: ExtractedReading[];
  parser?: { id: string; version: string };
  validation?: Invoice['validation'];
  confidence?: Invoice['confidence'];
  /** Contract data read from the invoice: saved on new contracts, fills gaps on existing ones. */
  contractDetails?: Pick<
    Contract,
    'supplyPointId' | 'tariffName' | 'loyaltyEndDate' | 'electricity' | 'gas' | 'telecom'
  >;
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
    const current = contract;
    const missing = Object.fromEntries(
      Object.entries(draft.contractDetails ?? {}).filter(
        ([field, value]) => value !== undefined && current[field as keyof Contract] === undefined,
      ),
    );
    // The escalão can change from one year to the next: the newest invoice decides.
    const escalao = draft.contractDetails?.gas?.escalao;
    if (escalao !== undefined && current.gas !== undefined && current.gas.escalao !== escalao) {
      const others = await repos.invoices.findBy('contractId', current.id);
      if (others.every((invoice) => invoice.issueDate <= draft.issueDate)) {
        missing.gas = { ...current.gas, escalao };
      }
    }
    // Services read from invoices follow the newest one until the user confirms them.
    const telecom = draft.contractDetails?.telecom;
    if (
      telecom &&
      current.telecom?.fromInvoice &&
      telecom.services.join() !== current.telecom.services.join()
    ) {
      const others = await repos.invoices.findBy('contractId', current.id);
      if (others.every((invoice) => invoice.issueDate <= draft.issueDate))
        missing.telecom = telecom;
    }
    if (Object.keys(missing).length > 0)
      contract = await repos.contracts.put({ ...current, ...missing });
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
    Object.assign(
      newContract,
      Object.fromEntries(
        Object.entries(draft.contractDetails ?? {}).filter(([, value]) => value !== undefined),
      ),
    );
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
    validation: draft.validation ?? 'not_checked',
    sources: draft.sources,
    confidence: draft.confidence ?? {},
    createdAt: now,
  };
  const optional = ['docId', 'atcud', 'docKey', 'periodStart', 'periodEnd', 'dueDate'] as const;
  for (const field of optional) {
    const value = draft[field];
    if (value) invoice[field] = value;
  }
  if (draft.vatCents !== undefined) invoice.vatCents = draft.vatCents;
  if (draft.parser) {
    invoice.parserId = draft.parser.id;
    invoice.parserVersion = draft.parser.version;
  }
  const saved = await repos.invoices.put(invoice);

  for (const line of draft.lines ?? []) {
    await repos.invoiceLines.put({
      id: crypto.randomUUID(),
      invoiceId: saved.id,
      kind: line.kind,
      description: line.description,
      amountCents: line.amountCents,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      ...(line.unit ? { unit: line.unit } : {}),
      ...(line.unitPrice ? { unitPrice: line.unitPrice } : {}),
      ...(line.period ? { period: line.period } : {}),
    });
  }
  for (const reading of draft.readings ?? []) {
    await repos.readings.put({
      id: crypto.randomUUID(),
      invoiceId: saved.id,
      contractId: contract.id,
      quantity: reading.quantity,
      unit: reading.unit,
      readingType: reading.readingType,
      dateFrom: draft.periodStart ?? reading.dateTo,
      dateTo: reading.dateTo,
      ...(reading.period ? { period: reading.period } : {}),
    });
  }
  return saved;
}
