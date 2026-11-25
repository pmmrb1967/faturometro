import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { Contract } from '../../domain/types';
import { createAccountKeys } from '../../lib/crypto';
import { categoryUses, removeCategory, saveCategory } from './save';

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
const CREATED = '2026-09-01T00:00:00.000Z';

describe('custom categories', () => {
  it('saves one with its note, and moves what used it when it is deleted', async () => {
    const id = await saveCategory(repos, { name: ' Animais ', note: ' Ração ' });
    expect(await repos.categories.get(id)).toMatchObject({ name: 'Animais', note: 'Ração' });

    await repos.transactions.put({
      id: 't',
      date: '2026-11-10',
      amountCents: 4500,
      category: id,
      description: 'Veterinário',
      source: 'manual',
      createdAt: CREATED,
    });
    await repos.expenses.put({
      id: 'e',
      name: 'Seguro do cão',
      amountCents: 1000,
      everyMonths: 1,
      dueDay: 1,
      startMonth: '2026-01',
      category: id,
      createdAt: CREATED,
    });
    const contract = { id: 'c', sector: 'other', category: id, createdAt: CREATED } as Omit<
      Contract,
      'updatedAt'
    >;
    await repos.contracts.put(contract);

    expect(await categoryUses(repos, id)).toBe(3);
    expect(await removeCategory(repos, id)).toBe(3);
    expect(await repos.categories.get(id)).toBeUndefined();
    expect((await repos.transactions.get('t'))?.category).toBe('other');
    expect((await repos.expenses.get('e'))?.category).toBe('other');
    expect((await repos.contracts.get('c'))?.category).toBeUndefined();
  });
});
