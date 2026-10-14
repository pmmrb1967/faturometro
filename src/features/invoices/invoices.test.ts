import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys } from '../../lib/crypto';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { emptyExtraction, type ExtractedInvoice } from '../../parsers/types';
import { buildDraft, defaultContractId, emptyForm, formFromQr } from './form';
import { DuplicateInvoiceError, saveInvoice } from './save';
import type { TelecomService } from '../../domain/types';

// Synthetic data only.
const QR =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260615*G:FT 1/100*H:ABCD-100*I1:PT*I3:28.65*I4:1.72*I7:10.10*I8:2.32*N:4.04*O:42.79*Q:abcd*R:1';

function qr(raw = QR): FiscalQr {
  const result = parseFiscalQr(raw);
  if (!result.ok) throw new Error('bad QR');
  return result.qr;
}

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
});

afterEach(async () => {
  await db.delete();
});

describe('buildDraft', () => {
  it('takes amounts, date, issuer and document id from the QR code', () => {
    const { form, locked } = formFromQr(qr());
    expect(form).toMatchObject({
      issuerNif: '500000000',
      issueDate: '2026-06-15',
      total: '42,79',
      vat: '4,04',
    });
    expect(locked).toMatchObject({ total: true, vat: true, issueDate: true });

    const result = buildDraft(
      { ...form, providerName: 'Fornecedor', contractLabel: 'Luz' },
      { fileHash: 'h', qr: qr(), docKey: 'k' },
      { providerKnown: false },
    );
    expect(result).toMatchObject({
      ok: true,
      draft: {
        totalCents: 4279,
        vatCents: 404,
        docId: 'FT 1/100',
        docKey: 'k',
        atcud: 'ABCD-100',
        qrStatus: 'ok',
        sources: { totalCents: 'qr' },
        contract: { label: 'Luz' },
      },
    });
  });

  it('ignores edits to QR amounts (the QR wins)', () => {
    const { form } = formFromQr(qr());
    const result = buildDraft(
      { ...form, total: '1,00', contractLabel: 'Luz' },
      { fileHash: 'h', qr: qr() },
      { providerKnown: true },
    );
    expect(result.ok && result.draft.totalCents).toBe(4279);
  });

  it('treats credit notes as negative', () => {
    const credit = qr(QR.replace('D:FT', 'D:NC'));
    const result = buildDraft(
      { ...formFromQr(credit).form, contractLabel: 'Luz' },
      { fileHash: 'h', qr: credit },
      { providerKnown: true },
    );
    expect(result.ok && result.draft.totalCents).toBe(-4279);
  });

  it('validates a manual entry', () => {
    const result = buildDraft(
      {
        ...emptyForm(),
        issuerNif: '123',
        total: 'abc',
        issueDate: '',
        periodStart: '2026-02-01',
        periodEnd: '2026-01-01',
      },
      { fileHash: 'manual' },
      { providerKnown: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['contractLabel', 'issueDate', 'issuerNif', 'periodEnd', 'providerName', 'total'].sort(),
    );
  });

  it('builds a manual draft with cents parsed from Portuguese amounts', () => {
    const result = buildDraft(
      {
        ...emptyForm(),
        issuerNif: '500000000',
        providerName: 'Água Municipal',
        sector: 'water',
        contractLabel: 'Água',
        issueDate: '2026-05-02',
        total: '1.234,56',
        vat: '',
        docId: 'FT 9/9',
      },
      { fileHash: 'manual' },
      { providerKnown: false },
    );
    expect(result).toMatchObject({
      ok: true,
      draft: { totalCents: 123456, qrStatus: 'missing', sector: 'water', docId: 'FT 9/9' },
    });
    expect(result.ok && result.draft.vatCents).toBeUndefined();
  });
});

describe('saveInvoice', () => {
  function draft(overrides = {}) {
    const result = buildDraft(
      { ...formFromQr(qr()).form, providerName: 'Fornecedor', contractLabel: 'Luz' },
      {
        fileHash: 'file-1',
        qr: qr(),
        docKey: 'doc-1',
        file: { fileHash: 'file-1', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
      },
      { providerKnown: false },
    );
    if (!result.ok) throw new Error('invalid draft');
    return { ...result.draft, ...overrides };
  }

  it('creates provider, contract, document and invoice', async () => {
    const invoice = await saveInvoice(repos, draft(), { keepOriginalFile: true });
    const [provider] = await repos.providers.list();
    const [contract] = await repos.contracts.list();
    expect(provider).toMatchObject({
      nif: '500000000',
      name: 'Fornecedor',
      sectors: ['electricity'],
    });
    expect(contract).toMatchObject({ label: 'Luz', providerId: provider?.id, active: true });
    expect(invoice).toMatchObject({ contractId: contract?.id, totalCents: 4279, vatCents: 404 });
    expect((await repos.documents.getByFileHash('file-1'))?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('keeps the escalão of the newest gas invoice, without losing the distributor', async () => {
    const gasDraft = (docKey: string, issueDate: string, escalao: 1 | 2) =>
      draft({
        sector: 'gas',
        docKey,
        issueDate,
        contractDetails: { gas: { escalao } },
      });
    const first = await saveInvoice(repos, gasDraft('g-1', '2026-06-21', 1), {
      keepOriginalFile: false,
    });
    const contract = await repos.contracts.get(first.contractId);
    await repos.contracts.put({ ...contract!, gas: { escalao: 1, distributor: 'LIS' } });

    await saveInvoice(
      repos,
      { ...gasDraft('g-2', '2026-11-21', 2), contract: { id: first.contractId } },
      { keepOriginalFile: false },
    );
    expect((await repos.contracts.get(first.contractId))?.gas).toEqual({
      escalao: 2,
      distributor: 'LIS',
    });

    // An older invoice saved later does not bring the old escalão back.
    await saveInvoice(
      repos,
      { ...gasDraft('g-0', '2026-03-21', 1), contract: { id: first.contractId } },
      { keepOriginalFile: false },
    );
    expect((await repos.contracts.get(first.contractId))?.gas?.escalao).toBe(2);
  });

  it('takes telecom services from the newest invoice until the user confirms them', async () => {
    const telecomDraft = (docKey: string, issueDate: string, services: TelecomService[]) =>
      draft({
        sector: 'telecom',
        docKey,
        issueDate,
        contractDetails: { telecom: { services, fromInvoice: true } },
      });
    const first = await saveInvoice(repos, telecomDraft('t-1', '2026-06-05', ['internet', 'tv']), {
      keepOriginalFile: false,
    });
    const contractId = first.contractId;
    const save = (docKey: string, issueDate: string, services: TelecomService[]) =>
      saveInvoice(
        repos,
        { ...telecomDraft(docKey, issueDate, services), contract: { id: contractId } },
        { keepOriginalFile: false },
      );

    await save('t-2', '2026-07-05', ['internet', 'tv', 'mobile']);
    expect((await repos.contracts.get(contractId))?.telecom?.services).toEqual([
      'internet',
      'tv',
      'mobile',
    ]);
    // An older invoice does not bring the old services back.
    await save('t-0', '2026-05-05', ['internet']);
    expect((await repos.contracts.get(contractId))?.telecom?.services).toHaveLength(3);

    // Once confirmed by the user, invoices no longer change them.
    const contract = await repos.contracts.get(contractId);
    await repos.contracts.put({ ...contract!, telecom: { services: ['internet', 'tv'] } });
    await save('t-3', '2026-08-05', ['internet', 'tv', 'mobile']);
    expect((await repos.contracts.get(contractId))?.telecom).toEqual({
      services: ['internet', 'tv'],
    });
  });

  it('reuses the provider and an existing contract', async () => {
    const first = await saveInvoice(repos, draft(), { keepOriginalFile: true });
    await saveInvoice(
      repos,
      draft({ contract: { id: first.contractId }, docKey: 'doc-2', sector: 'gas' }),
      { keepOriginalFile: true },
    );
    expect(await repos.providers.list()).toHaveLength(1);
    expect((await repos.providers.list())[0]?.sectors).toEqual(['electricity', 'gas']);
    expect(await repos.contracts.list()).toHaveLength(1);
    expect(await repos.invoices.findBy('fileHash', 'file-1')).toHaveLength(2);
  });

  it('refuses the same document twice', async () => {
    await saveInvoice(repos, draft(), { keepOriginalFile: true });
    await expect(saveInvoice(repos, draft(), { keepOriginalFile: true })).rejects.toBeInstanceOf(
      DuplicateInvoiceError,
    );
    expect(await repos.contracts.list()).toHaveLength(1);
  });

  it('does not keep the file when the setting is off', async () => {
    await saveInvoice(repos, draft(), { keepOriginalFile: false });
    expect(await repos.documents.getByFileHash('file-1')).toBeUndefined();
  });

  it('saves what a parser read: lines, readings, contract details and validation', async () => {
    const extraction: ExtractedInvoice = {
      ...emptyExtraction(),
      sector: 'electricity',
      periodStart: { value: '2026-05-22', confidence: 'high' },
      periodEnd: { value: '2026-06-21', confidence: 'high' },
      supplyPointId: { value: 'PT0000000000000000XX', confidence: 'high' },
      tariffName: { value: 'Tarifa Simples', confidence: 'high' },
      powerKva: { value: 6.9, confidence: 'high' },
      loyaltyEndDate: { value: '2027-06-30', confidence: 'high' },
      lines: [
        {
          kind: 'energy',
          description: 'Energia',
          amountCents: 3000,
          quantity: 226,
          unit: 'kWh',
          unitPrice: '0.13',
        },
        { kind: 'discount', description: 'Desc. Social', amountCents: -100 },
      ],
      readings: [
        { quantity: 226, unit: 'kWh', readingType: 'real', dateTo: '2026-06-21', period: 'full' },
      ],
    };
    const parsed = {
      parserId: 'test',
      providerName: 'Fornecedor Teste',
      parserVersion: '1.0.0',
      extraction,
      check: {
        validation: 'passed' as const,
        failures: [],
        confidence: { totalCents: 'high' as const },
      },
    };
    const { form } = formFromQr(qr(), parsed);
    expect(form).toMatchObject({
      periodStart: '2026-05-22',
      periodEnd: '2026-06-21',
      sector: 'electricity',
      // Suggested from the parser, editable.
      providerName: 'Fornecedor Teste',
      contractLabel: 'Eletricidade',
    });

    const result = buildDraft(
      { ...form, contractLabel: 'Luz' },
      { fileHash: 'file-9', qr: qr(), docKey: 'doc-9', parsed },
      { providerKnown: false },
    );
    if (!result.ok) throw new Error('invalid draft');
    expect(result.draft.sources).toMatchObject({ periodStart: 'parser', totalCents: 'qr' });
    const invoice = await saveInvoice(repos, result.draft, { keepOriginalFile: false });

    expect(invoice).toMatchObject({
      validation: 'passed',
      parserId: 'test',
      parserVersion: '1.0.0',
    });
    expect((await repos.providers.list())[0]?.name).toBe('Fornecedor Teste');
    expect(await repos.invoiceLines.findBy('invoiceId', invoice.id)).toHaveLength(2);
    const [reading] = await repos.readings.findBy('invoiceId', invoice.id);
    expect(reading).toMatchObject({
      quantity: 226,
      dateFrom: '2026-05-22',
      contractId: invoice.contractId,
    });
    expect(await repos.contracts.get(invoice.contractId)).toMatchObject({
      supplyPointId: 'PT0000000000000000XX',
      tariffName: 'Tarifa Simples',
      loyaltyEndDate: '2027-06-30',
      electricity: { powerKva: 6.9, cycle: 'simple', socialTariff: true },
    });
  });
});

describe('defaultContractId', () => {
  const light = { id: 'light', sector: 'electricity' as const, supplyPointId: 'PT-CPE-1' };
  const gas = { id: 'gas', sector: 'gas' as const, supplyPointId: 'PT-CUI-1' };
  const manual = { id: 'manual', sector: 'electricity' as const };

  it('matches the supply point first', () => {
    expect(defaultContractId([light, gas], 'gas', 'PT-CUI-1')).toBe('gas');
  });

  it('never puts a gas invoice on the electricity contract of the same provider', () => {
    expect(defaultContractId([light], 'gas', 'PT-CUI-1')).toBe('');
    expect(defaultContractId([light], 'gas')).toBe('');
  });

  it('proposes a new contract for another supply point of the same sector (another house)', () => {
    expect(defaultContractId([light], 'electricity', 'PT-CPE-2')).toBe('');
  });

  it('uses a same-sector contract without supply point (created by hand)', () => {
    expect(defaultContractId([manual], 'electricity', 'PT-CPE-2')).toBe('manual');
    expect(defaultContractId([light], 'electricity')).toBe('light');
  });
});
