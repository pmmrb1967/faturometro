import { describe, expect, it } from 'vitest';
import type { SpendingTransaction } from '../../domain/types';
import { docKeyFor } from '../ingest/ingest';
import { readReceipt, receiptTransactionId, type ReceiptDeps } from './receipt';

/** Example 5.2 of the specification (docs/qr-fiscal.md). */
const SIMPLIFIED =
  'A:123456789*B:999999990*C:PT*D:FS*E:N*F:20190812*G:FS CDVF/12345*H:CDF7T5HD-12345*I1:PT*I7:0.65*I8:0.15*N:0.15*O:0.80*Q:YhGV*R:9999*S:NU;0.80';

function deps(extra: Partial<ReceiptDeps> = {}): ReceiptDeps {
  return {
    readImage: async () => [{ text: SIMPLIFIED }],
    findInvoiceIdByDocKey: async () => undefined,
    getTransaction: async () => undefined,
    listTransactions: async () => [],
    issuerName: async () => undefined,
    ...extra,
  };
}

const read = (extra?: Partial<ReceiptDeps>) =>
  readReceipt(new Uint8Array(), 'image/jpeg', deps(extra));

describe('readReceipt', () => {
  it('fills a purchase from the QR code', async () => {
    const docKey = await docKeyFor('123456789', 'FS CDVF/12345');
    expect(await read()).toEqual({
      kind: 'read',
      draft: {
        id: receiptTransactionId(docKey),
        date: '2019-08-12',
        amountCents: 80,
        category: 'other',
        description: '',
        source: 'qr',
        issuerNif: '123456789',
        docKey,
      },
    });
  });

  it('says so when the photo has no fiscal QR code', async () => {
    expect(await read({ readImage: async () => [] })).toEqual({ kind: 'no_qr' });
    expect(await read({ readImage: async () => [{ text: 'A:1*B:2' }] })).toEqual({ kind: 'no_qr' });
  });

  it('refuses a document stored as an invoice or registered before', async () => {
    expect(await read({ findInvoiceIdByDocKey: async () => 'invoice' })).toEqual({
      kind: 'invoice',
    });
    const known = { id: 'x' } as SpendingTransaction;
    expect(await read({ getTransaction: async () => known })).toEqual({ kind: 'known' });
  });

  it('suggests the last description and category for the same issuer', async () => {
    const last = {
      id: 'x',
      date: '2019-01-01',
      issuerNif: '123456789',
      description: 'Mercearia',
      category: 'food',
    } as SpendingTransaction;
    const outcome = await read({
      listTransactions: async () => [last],
      issuerName: async () => 'Fornecedor conhecido',
    });
    expect(outcome).toMatchObject({ draft: { description: 'Mercearia', category: 'food' } });
  });

  it('falls back to the name of a known provider', async () => {
    const outcome = await read({ issuerName: async () => 'Fornecedor conhecido' });
    expect(outcome).toMatchObject({ draft: { description: 'Fornecedor conhecido' } });
  });

  it('takes a credit note off the month', async () => {
    const credit = SIMPLIFIED.replace('D:FS', 'D:NC');
    const outcome = await read({ readImage: async () => [{ text: credit }] });
    expect(outcome).toMatchObject({ draft: { amountCents: -80 } });
  });
});
