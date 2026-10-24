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
  readingWindow?: Invoice['readingWindow'];
  directDebitDate?: Invoice['directDebitDate'];
  extraUsage?: Invoice['extraUsage'];
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
    | 'supplyPointId'
    | 'tariffName'
    | 'loyaltyEndDate'
    | 'electricity'
    | 'gas'
    | 'telecom'
    | 'insurance'
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

/** The provider with this NIF, created (or given the sector) when needed. */
export async function ensureProvider(
  repos: Repositories,
  nif: string,
  name: string,
  sector: Sector,
): Promise<Provider> {
  const provider = await findProviderByNif(repos, nif);
  if (!provider) {
    return repos.providers.put({
      id: crypto.randomUUID(),
      nif,
      name: name.trim(),
      sectors: [sector],
    });
  }
  if (provider.sectors.includes(sector)) return provider;
  return repos.providers.put({ ...provider, sectors: [...provider.sectors, sector] });
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

  const provider = await ensureProvider(repos, draft.issuerNif, draft.providerName, draft.sector);

  let contract: Contract | undefined;
  if ('id' in draft.contract) {
    contract = await repos.contracts.get(draft.contract.id);
    if (!contract) throw new Error('Contract not found');
    contract = await updateContractDetails(repos, contract, draft.contractDetails, draft.issueDate);
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
    await linkToEndedContract(repos, contract, draft.periodEnd ?? draft.issueDate);
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
  if (draft.readingWindow) invoice.readingWindow = draft.readingWindow;
  if (draft.directDebitDate) invoice.directDebitDate = draft.directDebitDate;
  if (draft.extraUsage?.length) invoice.extraUsage = draft.extraUsage;
  if (draft.parser) {
    invoice.parserId = draft.parser.id;
    invoice.parserVersion = draft.parser.version;
  }
  const saved = await repos.invoices.put(invoice);

  await storeLinesAndReadings(repos, saved, draft.lines ?? [], draft.readings ?? []);
  return saved;
}

/**
 * A new contract after "Mudei de fornecedor" without saying which one: it
 * replaces the latest ended contract of the same sector, if the change was
 * before this invoice and nothing replaced it yet.
 */
async function linkToEndedContract(repos: Repositories, contract: Contract, invoiceDate: string) {
  const ended = (await repos.contracts.list())
    .filter(
      (other) =>
        other.id !== contract.id &&
        other.sector === contract.sector &&
        !other.active &&
        other.endedAt !== undefined &&
        other.endedAt <= invoiceDate &&
        other.replacedById === undefined,
    )
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0];
  if (ended) await repos.contracts.put({ ...ended, replacedById: contract.id });
}

/**
 * Contract data read from an invoice: fills what the contract does not have
 * yet, and for what changes over time (gas escalão, telecom services not yet
 * confirmed, insurance details) the newest invoice decides.
 */
export async function updateContractDetails(
  repos: Repositories,
  current: Contract,
  details: InvoiceDraft['contractDetails'],
  issueDate: string,
): Promise<Contract> {
  const missing = Object.fromEntries(
    Object.entries(details ?? {}).filter(
      ([field, value]) => value !== undefined && current[field as keyof Contract] === undefined,
    ),
  );
  const newest = async () =>
    (await repos.invoices.findBy('contractId', current.id)).every(
      (invoice) => invoice.issueDate <= issueDate,
    );
  // The escalão can change from one year to the next: the newest invoice decides.
  const escalao = details?.gas?.escalao;
  if (escalao !== undefined && current.gas !== undefined && current.gas.escalao !== escalao) {
    if (await newest()) missing.gas = { ...current.gas, escalao };
  }
  // Services read from invoices follow the newest one until the user confirms them.
  const telecom = details?.telecom;
  if (
    telecom &&
    current.telecom?.fromInvoice &&
    telecom.services.join() !== current.telecom.services.join()
  ) {
    if (await newest()) missing.telecom = telecom;
  }
  // A policy's objects and capitals change at each renewal: the newest receipt decides.
  const insurance = details?.insurance;
  if (insurance && current.insurance && (await newest())) {
    missing.insurance = { ...current.insurance, ...insurance };
  }
  return Object.keys(missing).length > 0
    ? repos.contracts.put({ ...current, ...missing })
    : current;
}

/** Stores an invoice's lines and meter readings (what a parser or the AI read). */
export async function storeLinesAndReadings(
  repos: Repositories,
  invoice: Pick<Invoice, 'id' | 'contractId' | 'periodStart'>,
  lines: readonly ExtractedLine[],
  readings: readonly ExtractedReading[],
): Promise<void> {
  for (const line of lines) {
    await repos.invoiceLines.put({
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      kind: line.kind,
      description: line.description,
      amountCents: line.amountCents,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      ...(line.unit ? { unit: line.unit } : {}),
      ...(line.unitPrice ? { unitPrice: line.unitPrice } : {}),
      ...(line.period ? { period: line.period } : {}),
    });
  }
  for (const reading of readings) {
    await repos.readings.put({
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      contractId: invoice.contractId,
      quantity: reading.quantity,
      unit: reading.unit,
      readingType: reading.readingType,
      dateFrom: invoice.periodStart ?? reading.dateTo,
      dateTo: reading.dateTo,
      ...(reading.period ? { period: reading.period } : {}),
    });
  }
}
