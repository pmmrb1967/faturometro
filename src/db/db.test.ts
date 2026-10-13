import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract, Invoice } from '../domain/types';
import { createAccountKeys } from '../lib/crypto';
import { createRepositories, type Repositories } from './repositories';
import { CURRENT_SCHEMA, ProfileDb, SCHEMA_V1, SCHEMA_V2, type TableName } from './schema';

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

  it('allows several invoices from one file, but not the same document twice', async () => {
    await repos.invoices.put(invoice({ fileHash: 'same', docKey: 'd1' }));
    await repos.invoices.put(invoice({ fileHash: 'same', docKey: 'd2' }));
    expect(await repos.invoices.findBy('fileHash', 'same')).toHaveLength(2);
    await expect(
      repos.invoices.put(invoice({ fileHash: 'other', docKey: 'd1' })),
    ).rejects.toThrow();
  });

  it('soft-deletes: hidden from reads, tombstone kept, unique index freed', async () => {
    const stored = await repos.invoices.put(invoice({ docKey: 'same' }));
    await repos.invoices.remove(stored.id);

    expect(await repos.invoices.get(stored.id)).toBeUndefined();
    expect(await repos.invoices.list()).toHaveLength(0);
    const tombstone = await db.invoices.get(stored.id);
    expect(tombstone?.deletedAt).toBeDefined();
    expect(tombstone?.docKey).toBeUndefined();

    await expect(repos.invoices.put(invoice({ docKey: 'same' }))).resolves.toBeDefined();
  });

  it('cannot read records with another key', async () => {
    const stored = await repos.contracts.put(contract());
    const { masterKey: otherKey } = await createAccountKeys('y', 1_000);
    const other = createRepositories(db, otherKey);
    await expect(other.contracts.get(stored.id)).rejects.toThrow();
  });
});

describe('DocumentStore', () => {
  it('stores the file encrypted, once per hash', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 conteúdo secreto');
    await repos.documents.put({ fileHash: 'h1', mime: 'application/pdf', bytes });
    await repos.documents.put({ fileHash: 'h1', mime: 'application/pdf', bytes });

    expect(await db.documents.count()).toBe(1);
    expect(JSON.stringify(await db.documents.toArray())).not.toContain('secreto');
    const stored = await repos.documents.getByFileHash('h1');
    expect(stored?.mime).toBe('application/pdf');
    expect(new TextDecoder().decode(stored?.bytes)).toBe('%PDF-1.7 conteúdo secreto');
  });
});

describe('schema migrations', () => {
  it('upgrades v1 to v2 keeping data and dropping the unique file hash on invoices', async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1
      .table('invoices')
      .add({ id: 'a', fileHash: 'same', docKey: 'd1', updatedAt: 'x', enc: {} });
    v1.close();

    const v2 = new Dexie(name);
    v2.version(1).stores(SCHEMA_V1);
    v2.version(2).stores(SCHEMA_V2);
    await v2
      .table('invoices')
      .add({ id: 'b', fileHash: 'same', docKey: 'd2', updatedAt: 'x', enc: {} });
    expect(await v2.table('invoices').where('fileHash').equals('same').count()).toBe(2);
    await expect(
      v2
        .table('invoices')
        .add({ id: 'c', fileHash: 'other', docKey: 'd1', updatedAt: 'x', enc: {} }),
    ).rejects.toThrow();
    expect(v2.verno).toBe(2);
    await v2.delete();
  });
});

describe('schema', () => {
  it('indexes every field the repositories copy in clear', () => {
    for (const [name, repo] of Object.entries(repos)) {
      const indexes = CURRENT_SCHEMA[name as TableName]
        .split(',')
        .map((index) => index.trim().replace(/^&/, ''));
      for (const field of repo.indexed) expect(indexes).toContain(field);
    }
  });
});
