/**
 * Reads a purchase from the fiscal QR code of a photographed receipt. The QR
 * code is the only source (nothing else on the receipt is read, and no AI),
 * and the user reviews the result before it is saved.
 */
import { lastFromIssuer } from '../../domain/spending';
import type { SpendingTransaction } from '../../domain/types';
import { parseFiscalQr, signedTotalCents, type FiscalQr } from '../../qr/parse';
import type { FoundQr } from '../../qr/scan';
import { docKeyFor } from '../ingest/ingest';

/** A purchase on the form: `createdAt` is set when it is first saved. */
export type TransactionDraft = Omit<SpendingTransaction, 'updatedAt' | 'createdAt'> & {
  createdAt?: string;
};

export interface ReceiptDeps {
  readImage(bytes: Uint8Array, mime: string): Promise<FoundQr[]>;
  findInvoiceIdByDocKey(docKey: string): Promise<string | undefined>;
  getTransaction(id: string): Promise<SpendingTransaction | undefined>;
  listTransactions(): Promise<readonly SpendingTransaction[]>;
  issuerName(nif: string): Promise<string | undefined>;
}

export type ReceiptOutcome =
  | { kind: 'read'; draft: TransactionDraft }
  | { kind: 'no_qr' }
  /** The document is stored as an invoice. */
  | { kind: 'invoice' }
  /** The receipt was registered before. */
  | { kind: 'known' };

/** Two devices reading the same receipt write the same record. */
export function receiptTransactionId(docKey: string): string {
  return `qr-${docKey}`;
}

function firstFiscal(found: readonly FoundQr[]): FiscalQr | null {
  for (const { text } of found) {
    const result = parseFiscalQr(text);
    if (result.ok) return result.qr;
  }
  return null;
}

export async function readReceipt(
  bytes: Uint8Array,
  mime: string,
  deps: ReceiptDeps,
): Promise<ReceiptOutcome> {
  const qr = firstFiscal(await deps.readImage(bytes, mime));
  if (!qr) return { kind: 'no_qr' };

  const docKey = qr.docId ? await docKeyFor(qr.issuerNif, qr.docId) : undefined;
  if (docKey) {
    if (await deps.findInvoiceIdByDocKey(docKey)) return { kind: 'invoice' };
    if (await deps.getTransaction(receiptTransactionId(docKey))) return { kind: 'known' };
  }

  const last = lastFromIssuer(await deps.listTransactions(), qr.issuerNif);
  const description = last?.description || ((await deps.issuerName(qr.issuerNif)) ?? '');
  return {
    kind: 'read',
    draft: {
      id: docKey ? receiptTransactionId(docKey) : crypto.randomUUID(),
      date: qr.date,
      amountCents: signedTotalCents(qr),
      category: last?.category ?? 'other',
      description,
      source: 'qr',
      issuerNif: qr.issuerNif,
      ...(docKey ? { docKey } : {}),
    },
  };
}
