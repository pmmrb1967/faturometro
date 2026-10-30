import 'fake-indexeddb/auto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys, sha256Hex } from '../../lib/crypto';
import { exportBackup, importBackup } from './backup';

async function newRepos(): Promise<Repositories> {
  const db = new ProfileDb(crypto.randomUUID());
  return createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
}

const pdf = new TextEncoder().encode('%PDF-1.7 fatura de teste');
let fileHash: string;
let source: Repositories;

beforeEach(async () => {
  fileHash = await sha256Hex(new Uint8Array(pdf));
  source = await newRepos();
  await source.contracts.put({
    id: 'c1',
    providerId: 'p1',
    sector: 'telecom',
    label: 'Internet',
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await source.invoices.put({
    id: 'i1',
    contractId: 'c1',
    providerId: 'p1',
    fileHash,
    docType: 'FT',
    issueDate: '2026-10-01',
    totalCents: 3000,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    createdAt: '2026-10-01T00:00:00.000Z',
  } as never);
  await source.settings.put({
    id: 'settings',
    aiApiKey: 'sk-ant-secreta',
    aiAutoSend: false,
    keepOriginalFiles: true,
    priceIncreaseThresholdPct: 5,
    loyaltyAlertDays: [60],
    autoLockMinutes: 15,
    largeFamily: true,
    cheaperOfferMinSavingCents: 3000,
    spendingEnabled: false,
  });
  await source.documents.put({ fileHash, mime: 'application/pdf', bytes: pdf });
});

describe('backup', () => {
  it('exports every record and the originals, without the AI key', async () => {
    const result = await exportBackup(source);
    expect(result).toMatchObject({ records: 3, files: 1 });
    const entries = unzipSync(result.zip);
    const json = strFromU8(entries['faturometro.json']!);
    expect(json).toContain('Internet');
    expect(json).not.toContain('sk-ant-secreta');
    const original = Object.keys(entries).find((name) => name.startsWith('originais/'));
    expect(original).toMatch(/\.pdf$/);
    expect(strFromU8(entries[original!]!)).toBe('%PDF-1.7 fatura de teste');
  });

  it('imports into another account, and a second import changes nothing', async () => {
    const { zip } = await exportBackup(source);
    const target = await newRepos();
    expect(await importBackup(target, zip)).toEqual({ added: 3, skipped: 0, files: 1 });
    expect(await target.contracts.get('c1')).toMatchObject({ label: 'Internet' });
    expect(await target.invoices.findBy('contractId', 'c1')).toHaveLength(1);
    expect((await target.settings.get('settings'))?.largeFamily).toBe(true);
    expect((await target.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);

    expect(await importBackup(target, zip)).toEqual({ added: 0, skipped: 3, files: 0 });
  });

  it('keeps newer local changes', async () => {
    const { zip } = await exportBackup(source);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await source.contracts.put({ ...(await source.contracts.get('c1'))!, label: 'Fibra' });
    await importBackup(source, zip);
    expect((await source.contracts.get('c1'))?.label).toBe('Fibra');
  });

  it('refuses what is not a backup, and originals that were changed', async () => {
    const target = await newRepos();
    await expect(importBackup(target, strToU8('não é um zip'))).rejects.toMatchObject({
      code: 'not_a_backup',
    });
    await expect(
      importBackup(target, zipSync({ 'faturometro.json': strToU8('{"format":"outro"}') })),
    ).rejects.toMatchObject({ code: 'not_a_backup' });

    const entries = unzipSync((await exportBackup(source)).zip);
    const original = Object.keys(entries).find((name) => name.startsWith('originais/'))!;
    entries[original] = strToU8('%PDF-1.7 alterado');
    const result = await importBackup(target, zipSync(entries));
    expect(result.files).toBe(0);
    expect(result.added).toBe(3);
  });
});
