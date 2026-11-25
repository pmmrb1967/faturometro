import type { Repositories } from '../../db/repositories';
import type { Warranty } from '../../domain/types';
import { WARRANTY_MONTHS } from '../../domain/warranty';
import { sha256Hex } from '../../lib/crypto';
import { refreshAlerts } from '../alerts/refresh';

export type WarrantyTerm = 'new' | 'usedAgreed' | 'other';

/** What the warranty fields hold while the user writes. */
export interface WarrantyFieldsValue {
  product: string;
  seller: string;
  deliveryDate: string;
  term: WarrantyTerm;
  /** Months typed for "Outro prazo". */
  otherMonths: string;
  notes: string;
  /** A new invoice or receipt (replaces the one kept, if any). */
  file: File | null;
}

export type WarrantyFieldErrors = Partial<
  Record<'product' | 'deliveryDate' | 'otherMonths' | 'file', string>
>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONTHS = 600;

export function emptyWarrantyFields(
  product: string,
  deliveryDate: string,
  existing?: Warranty,
): WarrantyFieldsValue {
  if (!existing) {
    return {
      product,
      seller: '',
      deliveryDate,
      term: 'new',
      otherMonths: '',
      notes: '',
      file: null,
    };
  }
  const term: WarrantyTerm =
    existing.months === WARRANTY_MONTHS.new
      ? 'new'
      : existing.months === WARRANTY_MONTHS.usedAgreed
        ? 'usedAgreed'
        : 'other';
  return {
    product: existing.product,
    seller: existing.seller ?? '',
    deliveryDate: existing.deliveryDate,
    term,
    otherMonths: term === 'other' ? String(existing.months) : '',
    notes: existing.notes ?? '',
    file: null,
  };
}

/** Months of the chosen term, or null when "Outro prazo" is not a whole number in range. */
export function termMonths(
  value: Pick<WarrantyFieldsValue, 'term' | 'otherMonths'>,
): number | null {
  if (value.term !== 'other') return WARRANTY_MONTHS[value.term];
  const months = Number(value.otherMonths.trim());
  return Number.isInteger(months) && months >= 1 && months <= MAX_MONTHS ? months : null;
}

export function validateWarrantyFields(
  value: WarrantyFieldsValue,
  purchaseDate: string,
  messages: {
    product: string;
    date: string;
    deliveryBefore: string;
    months: string;
  },
): WarrantyFieldErrors {
  const errors: WarrantyFieldErrors = {};
  if (!value.product.trim()) errors.product = messages.product;
  if (!DATE.test(value.deliveryDate)) errors.deliveryDate = messages.date;
  else if (DATE.test(purchaseDate) && value.deliveryDate < purchaseDate) {
    errors.deliveryDate = messages.deliveryBefore;
  }
  if (termMonths(value) === null) errors.otherMonths = messages.months;
  return errors;
}

/**
 * Stores a warranty (and its new document, encrypted like the originals of
 * the invoices), then refreshes the alerts: one appears in its last days.
 */
export async function saveWarranty(
  repos: Repositories,
  input: {
    existing?: Warranty;
    value: WarrantyFieldsValue;
    purchaseDate: string;
    priceCents?: number;
    transactionId?: string;
  },
): Promise<Warranty> {
  const { existing, value } = input;
  let fileHash = existing?.fileHash;
  if (value.file) {
    const bytes = new Uint8Array(await value.file.arrayBuffer());
    fileHash = await sha256Hex(bytes);
    await repos.documents.put({
      fileHash,
      mime: value.file.type || 'application/octet-stream',
      bytes,
    });
  }
  const seller = value.seller.trim();
  const notes = value.notes.trim();
  const transactionId = input.transactionId ?? existing?.transactionId;
  const saved = await repos.warranties.put({
    id: existing?.id ?? crypto.randomUUID(),
    product: value.product.trim(),
    ...(seller ? { seller } : {}),
    purchaseDate: input.purchaseDate,
    deliveryDate: value.deliveryDate,
    months: termMonths(value) ?? WARRANTY_MONTHS.new,
    ...(input.priceCents !== undefined && input.priceCents > 0
      ? { priceCents: input.priceCents }
      : {}),
    ...(fileHash ? { fileHash } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(notes ? { notes } : {}),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  await refreshAlerts(repos);
  return saved;
}

export async function removeWarranty(repos: Repositories, id: string): Promise<void> {
  await repos.warranties.remove(id);
  await refreshAlerts(repos);
}
