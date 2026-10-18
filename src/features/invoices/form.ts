/**
 * Review / manual entry form: the same form is used for QR-read invoices
 * (prefilled, QR fields read-only) and for invoices typed by hand.
 */
import { samePolicy } from '../insurance/policy-document';
import { AI_PARSER_PREFIX } from '../../ai/prompts/extract';
import { isValidNif } from '../../domain/nif';
import { isSocialDiscount } from '../../domain/social-tariff';
import type { Contract, Sector } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { parsePtAmount, type Cents } from '../../lib/money';
import { signedTotalCents, vatCents, type FiscalQr } from '../../qr/parse';
import type { ExtractedInvoice } from '../../parsers/types';
import type { ParsedDocument } from '../ingest/ingest';
import type { InvoiceDraft } from './save';

export const SECTORS: readonly Sector[] = [
  'electricity',
  'gas',
  'water',
  'telecom',
  'insurance',
  'other',
];

export interface InvoiceForm {
  issuerNif: string;
  providerName: string;
  sector: Sector;
  /** Existing contract id, or "" to create a new one. */
  contractId: string;
  contractLabel: string;
  customerNumber: string;
  docId: string;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  total: string;
  vat: string;
}

export type FormErrors = Partial<Record<keyof InvoiceForm, string>>;

/** Fields that come from the QR code and are not editable. */
export type LockedFields = Partial<Record<keyof InvoiceForm, true>>;

export interface FormBase {
  fileHash: string;
  file?: InvoiceDraft['file'];
  qr?: FiscalQr;
  docKey?: string;
  parsed?: ParsedDocument;
}

const centsToPt = (cents: Cents) => (cents / 100).toFixed(2).replace('.', ',');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyForm(): InvoiceForm {
  return {
    issuerNif: '',
    providerName: '',
    sector: 'electricity',
    contractId: '',
    contractLabel: '',
    customerNumber: '',
    docId: '',
    issueDate: '',
    periodStart: '',
    periodEnd: '',
    dueDate: '',
    total: '',
    vat: '',
  };
}

/** What a parser read that the QR code does not have. */
function fromExtraction(extraction?: ExtractedInvoice): Partial<InvoiceForm> {
  if (!extraction) return {};
  const form: Partial<InvoiceForm> = {};
  if (extraction.sector) {
    form.sector = extraction.sector;
    form.contractLabel = extraction.contractLabel?.value ?? t.sectors[extraction.sector];
  }
  if (extraction.customerNumber) form.customerNumber = extraction.customerNumber.value;
  if (extraction.periodStart) form.periodStart = extraction.periodStart.value;
  if (extraction.periodEnd) form.periodEnd = extraction.periodEnd.value;
  if (extraction.dueDate) form.dueDate = extraction.dueDate.value;
  return form;
}

/** Prefills the form from a parser's reading of a document without a usable QR code. */
export function formFromParsed(parsed: ParsedDocument): InvoiceForm {
  const { extraction } = parsed;
  const form: InvoiceForm = {
    ...emptyForm(),
    ...fromExtraction(extraction),
    providerName: parsed.providerName,
  };
  if (extraction.docId) form.docId = extraction.docId.value;
  if (extraction.issueDate) form.issueDate = extraction.issueDate.value;
  if (extraction.totalCents) form.total = centsToPt(extraction.totalCents.value);
  if (extraction.vatCents) form.vat = centsToPt(extraction.vatCents.value);
  return form;
}

/** Prefills the form from a QR code (and parser); returns the fields the user cannot change. */
export function formFromQr(
  qr: FiscalQr,
  parsed?: ParsedDocument,
): { form: InvoiceForm; locked: LockedFields } {
  return {
    form: {
      ...emptyForm(),
      ...fromExtraction(parsed?.extraction),
      providerName: parsed?.providerName ?? '',
      issuerNif: qr.issuerNif,
      docId: qr.docId ?? '',
      issueDate: qr.date,
      total: centsToPt(qr.totalCents),
      vat: centsToPt(vatCents(qr)),
    },
    locked: { issuerNif: true, issueDate: true, total: true, vat: true, docId: true },
  };
}

export function buildDraft(
  form: InvoiceForm,
  base: FormBase,
  options: { providerKnown: boolean },
): { ok: true; draft: InvoiceDraft } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const messages = t.invoices.errors;

  if (!isValidNif(form.issuerNif.trim())) errors.issuerNif = messages.nif;
  if (!options.providerKnown && !form.providerName.trim()) errors.providerName = messages.required;
  if (!form.contractId && !form.contractLabel.trim()) errors.contractLabel = messages.required;
  if (!ISO_DATE.test(form.issueDate)) errors.issueDate = messages.date;
  for (const field of ['periodStart', 'periodEnd', 'dueDate'] as const) {
    if (form[field] && !ISO_DATE.test(form[field])) errors[field] = messages.date;
  }
  if (form.periodStart && form.periodEnd && form.periodStart > form.periodEnd) {
    errors.periodEnd = messages.periodOrder;
  }

  const total = base.qr ? signedTotalCents(base.qr) : parsePtAmount(form.total);
  if (total === null) errors.total = messages.amount;
  const vat = base.qr ? vatCents(base.qr) : form.vat.trim() ? parsePtAmount(form.vat) : undefined;
  if (vat === null) errors.vat = messages.amount;

  if (Object.keys(errors).length > 0 || total === null || vat === null) {
    return { ok: false, errors };
  }

  const fromQr = base.qr !== undefined;
  const draft: InvoiceDraft = {
    fileHash: base.fileHash,
    issuerNif: form.issuerNif.trim(),
    providerName: form.providerName,
    sector: form.sector,
    contract: form.contractId
      ? { id: form.contractId }
      : { label: form.contractLabel, customerNumber: form.customerNumber },
    docType: base.qr?.docType ?? 'FT',
    issueDate: form.issueDate,
    totalCents: total,
    qrStatus: fromQr ? 'ok' : 'missing',
    sources: fromQr
      ? { issuerNif: 'qr', issueDate: 'qr', totalCents: 'qr', vatCents: 'qr', docId: 'qr' }
      : { issuerNif: 'manual', issueDate: 'manual', totalCents: 'manual', vatCents: 'manual' },
  };
  if (base.file) draft.file = base.file;
  if (vat !== undefined) draft.vatCents = vat;
  if (base.docKey) draft.docKey = base.docKey;
  if (base.qr?.atcud) draft.atcud = base.qr.atcud;
  const docId = base.qr?.docId ?? form.docId.trim();
  if (docId) draft.docId = docId;
  const extraction = base.parsed?.extraction;
  for (const field of ['periodStart', 'periodEnd', 'dueDate'] as const) {
    if (form[field]) {
      draft[field] = form[field];
      draft.sources[field] =
        extraction?.[field]?.value === form[field]
          ? base.parsed?.parserId.startsWith(AI_PARSER_PREFIX)
            ? 'ai'
            : 'parser'
          : 'manual';
    }
  }
  if (base.parsed && extraction) {
    draft.parser = { id: base.parsed.parserId, version: base.parsed.parserVersion };
    draft.lines = extraction.lines;
    draft.readings = extraction.readings;
    draft.validation = fromQr ? base.parsed.check.validation : 'not_checked';
    draft.confidence = base.parsed.check.confidence;
    draft.contractDetails = contractDetails(extraction, form.sector);
    if (extraction.readingWindow) draft.readingWindow = extraction.readingWindow.value;
    if (extraction.directDebitDate) draft.directDebitDate = extraction.directDebitDate.value;
    if (extraction.extraUsage?.length) draft.extraUsage = extraction.extraUsage;
  }
  return { ok: true, draft };
}

/** Contract data read from the invoice (CPE/CUI, tariff, power, cycle, social tariff, telecom services). */
export function contractDetails(
  extraction: ExtractedInvoice,
  sector: InvoiceForm['sector'],
): NonNullable<InvoiceDraft['contractDetails']> {
  const details: NonNullable<InvoiceDraft['contractDetails']> = {};
  if (extraction.supplyPointId) details.supplyPointId = extraction.supplyPointId.value;
  if (extraction.tariffName) details.tariffName = extraction.tariffName.value;
  if (extraction.loyaltyEndDate) details.loyaltyEndDate = extraction.loyaltyEndDate.value;
  if (sector === 'electricity' && extraction.powerKva) {
    // Cycle from how energy was billed (the meter may record more periods than are billed).
    const periods = new Set(
      extraction.lines.filter((line) => line.kind === 'energy').map((line) => line.period),
    );
    const cycle =
      periods.has('full') || periods.has('peak')
        ? 'tri'
        : periods.has('empty') || periods.has('off_empty')
          ? 'bi'
          : 'simple';
    details.electricity = {
      powerKva: extraction.powerKva.value,
      cycle,
      socialTariff: extraction.lines.some(isSocialDiscount),
    };
  }
  if (sector === 'gas' && extraction.gasEscalao) {
    details.gas = { escalao: extraction.gasEscalao.value };
  }
  if (sector === 'insurance' && extraction.insurance) {
    details.insurance = extraction.insurance.value;
  }
  if (sector === 'telecom' && extraction.telecomServices) {
    details.telecom = { services: extraction.telecomServices.value, fromInvoice: true };
  }
  return details;
}

/**
 * Contract to propose for an invoice of a known provider: the one with the
 * same supply point (CPE/CUI), else the one of the same sector; otherwise a
 * new contract ("" ). A provider can have several contracts (electricity and
 * gas from the same file), so "the first one" is never assumed.
 */
export function defaultContractId(
  contracts: readonly Pick<Contract, 'id' | 'sector' | 'supplyPointId' | 'insurance'>[],
  sector: Sector,
  supplyPointId?: string,
  policyNumber?: string,
): string {
  // Insurance: one contract per policy (car and home from the same insurer).
  if (policyNumber) {
    const same = contracts.find((contract) =>
      samePolicy(contract.insurance?.policyNumber, policyNumber),
    );
    if (same) return same.id;
    const unnumbered = contracts.find(
      (contract) => contract.sector === sector && !contract.insurance?.policyNumber,
    );
    return unnumbered?.id ?? '';
  }
  if (supplyPointId) {
    const same = contracts.find((contract) => contract.supplyPointId === supplyPointId);
    if (same) return same.id;
  }
  // A same-sector contract with a different supply point is another house: propose a new one.
  const candidate = contracts.find(
    (contract) => contract.sector === sector && (!supplyPointId || !contract.supplyPointId),
  );
  return candidate?.id ?? '';
}
