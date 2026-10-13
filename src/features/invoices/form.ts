/**
 * Review / manual entry form: the same form is used for QR-read invoices
 * (prefilled, QR fields read-only) and for invoices typed by hand.
 */
import { isValidNif } from '../../domain/nif';
import type { Sector } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { parsePtAmount, type Cents } from '../../lib/money';
import { signedTotalCents, vatCents, type FiscalQr } from '../../qr/parse';
import type { InvoiceDraft } from './save';

export const SECTORS: readonly Sector[] = ['electricity', 'gas', 'water', 'telecom', 'other'];

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

/** Prefills the form from a QR code; returns the fields the user cannot change. */
export function formFromQr(qr: FiscalQr): { form: InvoiceForm; locked: LockedFields } {
  return {
    form: {
      ...emptyForm(),
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
  for (const field of ['periodStart', 'periodEnd', 'dueDate'] as const) {
    if (form[field]) {
      draft[field] = form[field];
      draft.sources[field] = 'manual';
    }
  }
  return { ok: true, draft };
}
