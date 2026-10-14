import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { Contract, Invoice } from '../../domain/types';
import { createAccountKeys } from '../../lib/crypto';
import { replacedContract, totalSwitchSavings } from './switch-view';

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
});

afterEach(async () => {
  await db.delete();
});

function contract(id: string, overrides: Partial<Contract> = {}): Omit<Contract, 'updatedAt'> {
  return {
    id,
    providerId: `p-${id}`,
    sector: 'telecom',
    label: id,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function invoice(id: string, contractId: string, start: string, end: string, totalCents: number) {
  const value: Omit<Invoice, 'updatedAt'> = {
    id,
    contractId,
    providerId: `p-${contractId}`,
    fileHash: id,
    docType: 'FT',
    issueDate: end,
    periodStart: start,
    periodEnd: end,
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${end}T10:00:00.000Z`,
  };
  return value;
}

describe('switch savings from stored contracts', () => {
  it('compares the new contract with the one it replaced', async () => {
    expect(await totalSwitchSavings(repos)).toBeNull();
    await repos.contracts.put(
      contract('old', { active: false, endedAt: '2026-06-01', replacedById: 'new' }),
    );
    await repos.contracts.put(contract('new'));
    await repos.invoices.put(invoice('a', 'old', '2026-05-01', '2026-05-30', 6000));
    await repos.invoices.put(invoice('b', 'new', '2026-06-01', '2026-06-30', 4000));

    const current = (await repos.contracts.get('new'))!;
    const result = await replacedContract(repos, current);
    expect(result?.previous.id).toBe('old');
    expect(result?.savings).toMatchObject({ savingCents: 2000, method: 'perDay' });
    expect(await totalSwitchSavings(repos)).toBe(2000);
    expect(await replacedContract(repos, (await repos.contracts.get('old'))!)).toBeNull();
  });
});
