import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys } from '../../lib/crypto';
import { parseFiscalQr } from '../../qr/parse';
import { layoutFixtures } from '../../test/fixtures';
import { newerReader, reparseInvoice } from './reparse';

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
});

afterEach(async () => {
  await db.delete();
});

describe('reparse with a newer reader', () => {
  it('knows when a reader is newer than what read the invoice', () => {
    const nos = { nif: '502604751' };
    expect(newerReader({}, nos)?.id).toBe('nos');
    expect(newerReader({ parserId: 'ai:claude-haiku-5-5' }, nos)?.id).toBe('nos');
    expect(newerReader({ parserId: 'nos', parserVersion: '0.1.0' }, nos)?.id).toBe('nos');
    expect(newerReader({ parserId: 'nos', parserVersion: '999' }, nos)?.id).toBe('nos');
    expect(newerReader({}, { nif: '999999990' })).toBeUndefined();
  });

  it('reads a QR-only invoice again from its original, with lines and period', async () => {
    const fixture = layoutFixtures('nos').find((item) => item.name === 'synthetic-1.json')!;
    const parsed = parseFiscalQr(fixture.qrs[0]!.raw);
    if (!parsed.ok) throw new Error('bad QR');
    const qr = parsed.qr;
    await repos.providers.put({ id: 'p1', nif: qr.issuerNif, name: 'NOS', sectors: ['telecom'] });
    await repos.contracts.put({
      id: 'c1',
      providerId: 'p1',
      sector: 'telecom',
      label: 'Casa',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await repos.documents.put({
      fileHash: 'h1',
      mime: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const invoice = await repos.invoices.put({
      id: 'i1',
      contractId: 'c1',
      providerId: 'p1',
      fileHash: 'h1',
      docType: qr.docType ?? 'FT',
      ...(qr.docId ? { docId: qr.docId } : {}),
      issueDate: qr.date,
      totalCents: qr.totalCents,
      qrStatus: 'ok',
      validation: 'not_checked',
      sources: { total: 'qr' },
      confidence: {},
      createdAt: '2026-06-05T10:00:00.000Z',
    });

    const result = await reparseInvoice(repos, invoice, {
      readPdf: async () => ({
        pages: fixture.pages,
        qrs: fixture.qrs.map((item) => ({ text: item.raw, page: 1 })),
      }),
    });

    expect(result).toBe('updated');
    const saved = await repos.invoices.get('i1');
    expect(saved).toMatchObject({
      parserId: 'nos',
      validation: 'passed',
      totalCents: qr.totalCents,
    });
    expect(saved?.periodStart).toBeTruthy();
    expect((await repos.invoiceLines.findBy('invoiceId', 'i1')).length).toBeGreaterThan(0);
    expect((await repos.contracts.get('c1'))?.telecom?.services.length).toBeGreaterThan(0);
    // Reading again replaces the lines instead of adding to them.
    const count = (await repos.invoiceLines.findBy('invoiceId', 'i1')).length;
    await reparseInvoice(repos, saved!, {
      readPdf: async () => ({
        pages: fixture.pages,
        qrs: fixture.qrs.map((item) => ({ text: item.raw, page: 1 })),
      }),
    });
    expect((await repos.invoiceLines.findBy('invoiceId', 'i1')).length).toBe(count);
  });

  it('says when there is no original to read', async () => {
    const result = await reparseInvoice(
      repos,
      {
        id: 'x',
        contractId: 'c',
        providerId: 'p',
        fileHash: 'none',
        docType: 'FT',
        issueDate: '2026-01-01',
        totalCents: 1,
        qrStatus: 'ok',
        validation: 'not_checked',
        sources: {},
        confidence: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      { readPdf: async () => ({ pages: [], qrs: [] }) },
    );
    expect(result).toBe('no_original');
  });
});
