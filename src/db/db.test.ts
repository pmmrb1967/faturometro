import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract, Invoice } from '../domain/types';
import { createAccountKeys } from '../lib/crypto';
import { createRepositories, type Repositories } from './repositories';
import { ProfileDb, SCHEMA_V1, type TableName } from './schema';

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  const { masterKey } = await createAccountKeys('x', 1_000);
  repos = createRepositories(db, masterKey);
});

afterEach(async () => {
  await db.delete();
});

function contract(overrides: Partial<Contract> = {}): Omit<Contract, 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    providerId: 'provider-1',
    sector: 'electricity',
    label: 'Luz',
    customerNumber: 'CLIENTE-SECRETO-123',
    supplyPointId: 'PT0002000012345678XY',
    active: true,
    createdAt: '2026-10-13T10:00:00.000Z',
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Omit<Invoice, 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    contractId: 'contract-1',
    providerId: 'provider-1',
    fileHash: 'hash-1',
    docKey: 'doc-1',
    docType: 'FT',
    issueDate: '2026-07-24',
    totalCents: 1562,
    qrStatus: 'ok',
    validation: 'not_checked',
    sources: {},
    confidence: {},
    createdAt: '2026-10-13T10:00:00.000Z',
    ...overrides,
  };
}

describe('EncryptedTable', () => {
  it('round-trips a record and stamps updatedAt', async () => {
    const stored = await repos.contracts.put(contract());
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await repos.contracts.get(stored.id)).toEqual(stored);
  });

  it('stores only indexed fields in clear', async () => {
    const stored = await repos.contracts.put(contract());
    const row = await db.contracts.get(stored.id);
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('CLIENTE-SECRETO-123');
    expect(raw).not.toContain('PT0002000012345678XY');
    expect(raw).not.toContain('Luz');
    expect(row).toMatchObject({ id: stored.id, providerId: 'provider-1', sector: 'electricity' });
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'enc',
      'id',
      'providerId',
      'sector',
      'updatedAt',
    ]);
  });

  it('finds by indexed field', async () => {
    await repos.invoices.put(invoice({ contractId: 'a', fileHash: 'h1', docKey: 'd1' }));
    await repos.invoices.put(invoice({ contractId: 'a', fileHash: 'h2', docKey: 'd2' }));
    await repos.invoices.put(invoice({ contractId: 'b', fileHash: 'h3', docKey: 'd3' }));
    expect(await repos.invoices.findBy('contractId', 'a')).toHaveLength(2);
    expect((await repos.invoices.findBy('fileHash', 'h3'))[0]?.contractId).toBe('b');
  });

  it('enforces unique file hashes', async () => {
    await repos.invoices.put(invoice({ fileHash: 'same', docKey: 'd1' }));
    await expect(repos.invoices.put(invoice({ fileHash: 'same', docKey: 'd2' }))).rejects.toThrow();
  });

  it('soft-deletes: hidden from reads, tombstone kept, unique index freed', async () => {
    const stored = await repos.invoices.put(invoice({ fileHash: 'same' }));
    await repos.invoices.remove(stored.id);

    expect(await repos.invoices.get(stored.id)).toBeUndefined();
    expect(await repos.invoices.list()).toHaveLength(0);
    const tombstone = await db.invoices.get(stored.id);
    expect(tombstone?.deletedAt).toBeDefined();
    expect(tombstone?.fileHash).toBeUndefined();

    await expect(repos.invoices.put(invoice({ fileHash: 'same' }))).resolves.toBeDefined();
  });

  it('cannot read records with another key', async () => {
    const stored = await repos.contracts.put(contract());
    const { masterKey: otherKey } = await createAccountKeys('y', 1_000);
    const other = createRepositories(db, otherKey);
    await expect(other.contracts.get(stored.id)).rejects.toThrow();
  });
});

describe('schema v1', () => {
  it('indexes every field the repositories copy in clear', () => {
    for (const [name, repo] of Object.entries(repos)) {
      const indexes = SCHEMA_V1[name as TableName]
        .split(',')
        .map((index) => index.trim().replace(/^&/, ''));
      for (const field of repo.indexed) expect(indexes).toContain(field);
    }
  });
});
