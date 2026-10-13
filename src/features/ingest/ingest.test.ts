import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../lib/crypto';
import { PdfPasswordError } from '../../pdf/text';
import { docKeyFor, ingestFile, type IngestDeps } from './ingest';

// Synthetic QR codes (AT specification style); no real invoice data.
const QR_LIGHT =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260615*G:FT 1/100*H:ABCD-100*I1:PT*I3:28.65*I4:1.72*I7:10.10*I8:2.32*N:4.04*O:42.79*Q:abcd*R:1';
const QR_GAS =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260615*G:FT 1/101*H:ABCD-101*I1:PT*I7:10.62*I8:2.44*N:2.44*O:13.06*Q:abcd*R:1';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 synthetic');
const PAGES = [{ page: 1, width: 595, height: 842, items: [] }];

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    findInvoiceIdByFileHash: async () => undefined,
    findInvoiceIdByDocKey: async () => undefined,
    readPdf: async () => ({ pages: PAGES, qrs: [{ text: QR_LIGHT, page: 2 }] }),
    readImage: async () => [],
    ...overrides,
  };
}

describe('ingestFile', () => {
  it('reads a PDF: hash, pages and parsed QR codes', async () => {
    const outcome = await ingestFile({ bytes: PDF_BYTES, mime: 'application/pdf' }, deps());
    expect(outcome).toMatchObject({
      kind: 'read',
      fileKind: 'pdf',
      fileHash: await sha256Hex(PDF_BYTES),
      pages: PAGES,
      qrStatus: 'ok',
    });
    if (outcome.kind !== 'read') return;
    expect(outcome.qrs).toHaveLength(1);
    expect(outcome.qrs[0]?.result).toMatchObject({ ok: true, qr: { totalCents: 4279 } });
    expect(outcome.qrs[0]?.docKey).toBe(await docKeyFor('500000000', 'FT 1/100'));
  });

  it('keeps every QR code of a document (one invoice per QR)', async () => {
    const outcome = await ingestFile(
      { bytes: PDF_BYTES, mime: 'application/pdf' },
      deps({
        readPdf: async () => ({
          pages: PAGES,
          qrs: [
            { text: QR_LIGHT, page: 2 },
            { text: QR_GAS, page: 3 },
          ],
        }),
      }),
    );
    expect(outcome.kind === 'read' && outcome.qrs.map((qr) => qr.found.page)).toEqual([2, 3]);
  });

  it('detects PDFs by content when the browser gives no type', async () => {
    const outcome = await ingestFile({ bytes: PDF_BYTES, mime: '' }, deps());
    expect(outcome).toMatchObject({ kind: 'read', fileKind: 'pdf', mime: 'application/pdf' });
  });

  it('stops at a file already imported', async () => {
    const outcome = await ingestFile(
      { bytes: PDF_BYTES, mime: 'application/pdf' },
      deps({ findInvoiceIdByFileHash: async () => 'invoice-1' }),
    );
    expect(outcome).toMatchObject({ kind: 'duplicate_file', invoiceId: 'invoice-1' });
  });

  it('flags QR codes of invoices already stored (same issuer and document id)', async () => {
    const known = await docKeyFor('500000000', 'FT 1/100');
    const outcome = await ingestFile(
      { bytes: PDF_BYTES, mime: 'application/pdf' },
      deps({ findInvoiceIdByDocKey: async (key) => (key === known ? 'invoice-9' : undefined) }),
    );
    expect(outcome.kind === 'read' && outcome.qrs[0]?.duplicateInvoiceId).toBe('invoice-9');
  });

  it('tries the given passwords in order and reports which one worked', async () => {
    const readPdf = vi.fn(async (_bytes: Uint8Array, password?: string) => {
      if (password !== '123456789') throw new PdfPasswordError(password ? 'incorrect' : 'needed');
      return { pages: PAGES, qrs: [] };
    });
    const outcome = await ingestFile(
      { bytes: PDF_BYTES, mime: 'application/pdf' },
      deps({ readPdf }),
      ['000000000', '123456789'],
    );
    expect(outcome).toMatchObject({ kind: 'read', usedPassword: '123456789', qrStatus: 'missing' });
    expect(readPdf.mock.calls.map(([, password]) => password)).toEqual([
      undefined,
      '000000000',
      '123456789',
    ]);
  });

  it('asks for a password when none works', async () => {
    const readPdf = async () => {
      throw new PdfPasswordError('needed');
    };
    expect(await ingestFile({ bytes: PDF_BYTES, mime: '' }, deps({ readPdf }))).toEqual({
      kind: 'needs_password',
      reason: 'needed',
    });
    expect(await ingestFile({ bytes: PDF_BYTES, mime: '' }, deps({ readPdf }), ['x'])).toEqual({
      kind: 'needs_password',
      reason: 'incorrect',
    });
  });

  it('reads QR codes from photos', async () => {
    const outcome = await ingestFile(
      { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' },
      deps({ readImage: async () => [{ text: QR_GAS }] }),
    );
    expect(outcome).toMatchObject({ kind: 'read', fileKind: 'image', qrStatus: 'ok', pages: [] });
  });

  it('marks unreadable QR codes as invalid', async () => {
    const outcome = await ingestFile(
      { bytes: PDF_BYTES, mime: 'application/pdf' },
      deps({ readPdf: async () => ({ pages: PAGES, qrs: [{ text: 'A:1*B:2*F:2026*O:x' }] }) }),
    );
    expect(outcome).toMatchObject({ kind: 'read', qrStatus: 'invalid' });
  });

  it('rejects other file types', async () => {
    expect(
      await ingestFile({ bytes: new Uint8Array([1, 2, 3]), mime: 'text/plain' }, deps()),
    ).toEqual({ kind: 'unsupported' });
  });
});
