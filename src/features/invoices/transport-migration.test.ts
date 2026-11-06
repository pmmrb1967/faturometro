import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { Contract, Invoice, Provider } from '../../domain/types';
import { createAccountKeys } from '../../lib/crypto';
import { moveViaVerdeToTransport } from './transport-migration';

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
});

afterEach(async () => {
  await db.delete();
});

// Synthetic data only.
async function provider(id: string, nif: string, sectors: Provider['sectors']) {
  await repos.providers.put({ id, nif, name: id, sectors });
}
async function contract(id: string, providerId: string, sector: Contract['sector']) {
  await repos.contracts.put({
    id,
    providerId,
    sector,
    label: id,
    active: true,
    createdAt: '2026-06-01T00:00:00.000Z',
  });
}
async function invoice(id: string, contractId: string, providerId: string, parserId?: string) {
  const record: Omit<Invoice, 'updatedAt'> = {
    id,
    contractId,
    providerId,
    fileHash: id,
    docType: 'FT',
    issueDate: '2026-06-30',
    totalCents: 100,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: '2026-06-30T10:00:00.000Z',
  };
  if (parserId) record.parserId = parserId;
  await repos.invoices.put(record);
}

describe('moveViaVerdeToTransport', () => {
  it('moves the Via Verde contract and its issuers to transport, once', async () => {
    await provider('holder', '510000002', ['other']);
    await provider('issuer', '500000000', ['other']);
    await provider('shop', '500000018', ['other']);
    await contract('via-verde', 'holder', 'other');
    await contract('shop', 'shop', 'other');
    await invoice('i1', 'via-verde', 'issuer', 'via-verde');
    await invoice('i2', 'via-verde', 'holder', 'via-verde');
    await invoice('i3', 'shop', 'shop');

    expect(await moveViaVerdeToTransport(repos)).toBe(1);
    expect((await repos.contracts.get('via-verde'))?.sector).toBe('transport');
    // Another "other" expense stays where it is.
    expect((await repos.contracts.get('shop'))?.sector).toBe('other');
    expect((await repos.providers.get('holder'))?.sectors).toEqual(['transport']);
    expect((await repos.providers.get('issuer'))?.sectors).toEqual(['transport']);
    expect((await repos.providers.get('shop'))?.sectors).toEqual(['other']);

    // Nothing left to move: no new writes (nothing to sync again).
    const updatedAt = (await repos.contracts.get('via-verde'))?.updatedAt;
    expect(await moveViaVerdeToTransport(repos)).toBe(0);
    expect((await repos.contracts.get('via-verde'))?.updatedAt).toBe(updatedAt);
  });

  it('keeps "other" on a provider that also has other expenses', async () => {
    await provider('both', '500000000', ['other']);
    await contract('via-verde', 'both', 'other');
    await contract('shop', 'both', 'other');
    await invoice('i1', 'via-verde', 'both', 'via-verde');
    await invoice('i2', 'shop', 'both');

    await moveViaVerdeToTransport(repos);
    expect((await repos.providers.get('both'))?.sectors).toEqual(['other', 'transport']);
  });
});
