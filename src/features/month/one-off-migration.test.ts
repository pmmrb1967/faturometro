import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { paymentId } from '../../domain/month';
import type { RecurringExpense } from '../../domain/types';
import { createAccountKeys } from '../../lib/crypto';
import { moveOneOffExpenses, oneOffAsTransaction } from './one-off-migration';

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
function oneOff(id: string, extra: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id,
    updatedAt: CREATED,
    name: `Obra ${id}`,
    amountCents: 120000,
    everyMonths: 1,
    oneOff: true,
    dueDay: 31,
    startMonth: '2026-11',
    endMonth: '2026-11',
    category: 'home',
    createdAt: CREATED,
    ...extra,
  };
}

describe('oneOffAsTransaction', () => {
  it('keeps the due day (the last day of a shorter month) and stays to pay', () => {
    expect(oneOffAsTransaction(oneOff('a'), [])).toEqual({
      id: 'a',
      date: '2026-11-30',
      amountCents: 120000,
      category: 'home',
      description: 'Obra a',
      source: 'manual',
      toPay: true,
      createdAt: CREATED,
    });
  });

  it('keeps the day it was ticked as paid, or its day when added as already paid', () => {
    const mark = {
      id: paymentId({ expenseId: 'a', month: '2026-11' }),
      updatedAt: CREATED,
      expenseId: 'a',
      month: '2026-11',
      paidOn: '2026-12-02',
    };
    expect(oneOffAsTransaction(oneOff('a'), [mark])).toMatchObject({ paidOn: '2026-12-02' });
    const before = oneOffAsTransaction(oneOff('b', { paidUntil: '2026-12-05' }), []);
    expect(before).not.toHaveProperty('toPay');
    expect(before).not.toHaveProperty('paidOn');
  });

  it('takes the amount of its month and "Outros" when it had no category', () => {
    const changed = oneOff('c', {
      category: undefined,
      amountChanges: [{ fromMonth: '2026-11', amountCents: 99000 }],
    });
    expect(oneOffAsTransaction(changed, [])).toMatchObject({
      amountCents: 99000,
      category: 'other',
    });
  });
});

describe('moveOneOffExpenses', () => {
  it('moves one-off expenses with their marks and leaves recurring ones', async () => {
    await repos.expenses.put(oneOff('works'));
    await repos.expenses.put({ ...oneOff('rent'), oneOff: undefined, endMonth: undefined });
    await repos.payments.put({
      id: paymentId({ expenseId: 'works', month: '2026-11' }),
      expenseId: 'works',
      month: '2026-11',
      paidOn: '2026-11-30',
    });

    expect(await moveOneOffExpenses(repos)).toBe(1);
    expect((await repos.expenses.list()).map((expense) => expense.id)).toEqual(['rent']);
    expect(await repos.payments.list()).toEqual([]);
    const moved = await repos.transactions.get('works');
    expect(moved).toMatchObject({ date: '2026-11-30', description: 'Obra works' });
    expect(moved).not.toHaveProperty('toPay');
    // Nothing left to move: nothing is written.
    expect(await moveOneOffExpenses(repos)).toBe(0);
  });

  it('does not overwrite the one-off expense when the old record comes back', async () => {
    await repos.transactions.put({
      ...oneOffAsTransaction(oneOff('works'), []),
      description: 'Changed after the move',
    });
    await repos.expenses.put(oneOff('works'));

    await moveOneOffExpenses(repos);
    expect(await repos.expenses.list()).toEqual([]);
    expect((await repos.transactions.get('works'))?.description).toBe('Changed after the move');
  });
});
