import { describe, expect, it } from 'vitest';
import { categoryOrder, contractCategory, isAppCategory, knownCategory } from './categories';
import { spendingMonth } from './spending';
import type { Contract, Invoice, SpendingTransaction } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };

describe('categories', () => {
  it("tells the app's from the user's, and counts an unknown one as other", () => {
    expect(isAppCategory('food')).toBe(true);
    expect(isAppCategory('c-1')).toBe(false);
    expect(knownCategory('c-1', [{ id: 'c-1' }])).toBe('c-1');
    expect(knownCategory('c-2', [{ id: 'c-1' }])).toBe('other');
    expect(knownCategory(undefined, [])).toBe('other');
  });

  it("lists the app's, then the user's by name, and Outros last", () => {
    const order = categoryOrder([
      { id: 'c-z', name: 'Viagens' },
      { id: 'c-a', name: 'Animais' },
    ]);
    expect(order.slice(-3)).toEqual(['c-a', 'c-z', 'other']);
    expect(order[0]).toBe('food');
  });

  it("puts a contract's invoices in its category, or its sector's", () => {
    expect(contractCategory({ sector: 'electricity' })).toBe('bills');
    expect(contractCategory({ sector: 'other', category: 'leisure' })).toBe('leisure');
  });

  it('sums the month by category, the user’s included', () => {
    const gym = { ...META, id: 'g', sector: 'other', category: 'c-gym' } as unknown as Contract;
    const invoice = {
      ...META,
      id: 'i',
      contractId: 'g',
      providerId: 'p',
      fileHash: 'h',
      docKey: 'k',
      docType: 'FT',
      issueDate: '2026-11-02',
      dueDate: '2026-11-05',
      totalCents: 3000,
      qrStatus: 'ok',
    } as Invoice;
    const vet: SpendingTransaction = {
      ...META,
      id: 't',
      date: '2026-11-10',
      amountCents: 4500,
      category: 'c-pets',
      description: 'Veterinário',
      source: 'manual',
    };
    const lost: SpendingTransaction = { ...vet, id: 'u', amountCents: 500, category: 'c-gone' };
    const month = spendingMonth('2026-11', {
      invoices: [invoice],
      contracts: [gym],
      expenses: [],
      transactions: [vet, lost],
      categories: [
        { ...META, id: 'c-gym', name: 'Ginásio' },
        { ...META, id: 'c-pets', name: 'Animais' },
      ],
    });
    expect(month.byCategory).toEqual([
      { category: 'c-pets', totalCents: 4500 },
      { category: 'c-gym', totalCents: 3000 },
      { category: 'other', totalCents: 500 },
    ]);
  });
});
