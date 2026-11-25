import { describe, expect, it } from 'vitest';
import {
  categoryShare,
  lastFromIssuer,
  monthProgress,
  sortSpendingItems,
  spendingMonth,
  yearProgress,
  type SpendingData,
  type SpendingOrder,
} from './spending';
import type { Contract, Income, Invoice, RecurringExpense, SpendingTransaction } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function contract(id: string, sector: Contract['sector']): Contract {
  return { ...META, id, sector } as Contract;
}

function invoice(id: string, contractId: string, dueDate: string, totalCents: number): Invoice {
  return {
    ...META,
    id,
    contractId,
    providerId: 'p1',
    fileHash: id,
    docKey: `key-${id}`,
    docType: 'FT',
    issueDate: dueDate,
    dueDate,
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: META.updatedAt,
  };
}

function expense(extra: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    ...META,
    id: 'rent',
    name: 'Renda',
    amountCents: 65000,
    everyMonths: 1,
    dueDay: 8,
    startMonth: '2026-01',
    createdAt: META.updatedAt,
    ...extra,
  };
}

function purchase(
  id: string,
  date: string,
  amountCents: number,
  extra: Partial<SpendingTransaction> = {},
): SpendingTransaction {
  return {
    ...META,
    id,
    date,
    amountCents,
    category: 'food',
    description: '',
    source: 'manual',
    createdAt: META.updatedAt,
    ...extra,
  };
}

const empty: SpendingData = { invoices: [], expenses: [], transactions: [], contracts: [] };

describe('yearProgress', () => {
  const TODAY = '2026-10-15';
  const salary = (extra: Partial<Income> = {}): Income => ({
    ...META,
    id: 'salary',
    kind: 'salary',
    name: '',
    amountCents: 150000,
    everyMonths: 1,
    dueDay: 28,
    startMonth: '2026-09',
    createdAt: META.updatedAt,
    ...extra,
  });

  it('gives each month its own total, with no spending as a gap and not as zero', () => {
    const year = yearProgress(
      '2026',
      {
        ...empty,
        transactions: [
          purchase('a', '2026-01-10', 1000),
          purchase('b', '2026-01-20', 500),
          purchase('c', '2026-03-05', 2000),
        ],
      },
      [],
      TODAY,
    );
    expect(year?.current.slice(0, 4)).toEqual([1500, null, 2000, null]);
    expect(year?.spent).toEqual({ lastMonth: 2, totalCents: 3500 });
  });

  it('stops today: what is still due this month is not spent', () => {
    const year = yearProgress(
      '2026',
      {
        ...empty,
        transactions: [purchase('a', '2026-10-15', 1000), purchase('b', '2026-10-16', 500)],
      },
      [],
      TODAY,
    );
    expect(year?.current[9]).toBe(1000);
    expect(year?.current[10]).toBeNull();
  });

  it('shows the whole months of the year before', () => {
    const year = yearProgress(
      '2026',
      { ...empty, transactions: [purchase('a', '2025-12-20', 900)] },
      [],
      TODAY,
    );
    expect(year?.previous[11]).toBe(900);
    expect(year?.spent).toBeNull();
    expect(year?.compared).toBeNull();
  });

  it('compares only the months recorded in both years', () => {
    const year = yearProgress(
      '2026',
      {
        ...empty,
        transactions: [
          purchase('a', '2025-02-10', 300),
          purchase('b', '2026-02-10', 400),
          purchase('c', '2026-03-10', 9000),
          purchase('d', '2025-05-10', 7000),
        ],
      },
      [],
      TODAY,
    );
    expect(year?.compared).toEqual({ months: 1, currentCents: 400, previousCents: 300 });
  });

  it('compares the running month up to the same day of last year', () => {
    const year = yearProgress(
      '2026',
      {
        ...empty,
        transactions: [
          purchase('a', '2025-10-10', 300),
          purchase('b', '2025-10-20', 5000),
          purchase('c', '2026-10-10', 400),
        ],
      },
      [],
      TODAY,
    );
    expect(year?.previous[9]).toBe(5300);
    expect(year?.compared).toEqual({ months: 1, currentCents: 400, previousCents: 300 });
  });

  it('warns while purchases are on one side of the comparison only', () => {
    const data = {
      ...empty,
      expenses: [expense({ startMonth: '2025-01' })],
      transactions: [purchase('a', '2026-09-10', 1000)],
    };
    expect(yearProgress('2026', data, [], TODAY)?.purchasesSince).toBe('2026-09');
  });

  it('does not warn once both sides have purchases, or with none at all', () => {
    const both = {
      ...empty,
      expenses: [expense({ startMonth: '2025-01' })],
      transactions: [purchase('a', '2025-01-10', 1000)],
    };
    expect(yearProgress('2026', both, [], TODAY)?.purchasesSince).toBeNull();
    const none = { ...empty, expenses: [expense({ startMonth: '2025-01' })] };
    expect(yearProgress('2026', none, [], TODAY)?.purchasesSince).toBeNull();
  });

  it('gives the income of each month, up to today', () => {
    const year = yearProgress(
      '2026',
      { ...empty, transactions: [purchase('a', '2026-09-10', 1000)] },
      [salary()],
      TODAY,
    );
    expect(year?.income.slice(7, 11)).toEqual([null, 150000, 150000, null]);
  });

  it('is null for a year to come, or with nothing recorded', () => {
    const data = { ...empty, transactions: [purchase('a', '2026-09-10', 1000)] };
    expect(yearProgress('2027', data, [], TODAY)).toBeNull();
    expect(yearProgress('2024', data, [], TODAY)).toBeNull();
  });
});

describe('sortSpendingItems', () => {
  const items = spendingMonth('2026-10', {
    ...empty,
    invoices: [invoice('power', 'c1', '2026-10-20', 5000)],
    contracts: [contract('c1', 'electricity')],
    expenses: [expense({ category: 'home' })],
    transactions: [
      purchase('shop', '2026-10-25', 2000),
      purchase('fun', '2026-10-10', 7000, { category: 'leisure' }),
    ],
  }).items;
  const ids = (order: SpendingOrder) => sortSpendingItems(items, order).map((item) => item.id);
  const [shop, power, fun, rent] = [
    'transaction-shop',
    'invoice-power',
    'transaction-fun',
    'expense-rent-2026-10',
  ];

  it('keeps the list by date, newest first', () => {
    expect(ids('date')).toEqual([shop, power, fun, rent]);
  });

  it('by amount, highest first', () => {
    expect(ids('amount')).toEqual([rent, fun, power, shop]);
  });

  it('by type: invoices, expenses, purchases, each by date', () => {
    expect(ids('type')).toEqual([power, rent, shop, fun]);
  });

  it('by category, in the order of the list of categories', () => {
    expect(ids('category')).toEqual([shop, rent, power, fun]);
  });
});

describe('spendingMonth', () => {
  it('joins invoices, recurring expenses and purchases, newest first', () => {
    const summary = spendingMonth('2026-10', {
      contracts: [contract('light', 'electricity'), contract('car', 'insurance')],
      invoices: [
        invoice('i1', 'light', '2026-10-20', 4000),
        invoice('i2', 'car', '2026-10-02', 12000),
      ],
      expenses: [expense({ category: 'home' })],
      transactions: [purchase('t1', '2026-10-15', 2550)],
    });

    expect(summary.items.map((item) => item.id)).toEqual([
      'invoice-i1',
      'transaction-t1',
      'expense-rent-2026-10',
      'invoice-i2',
    ]);
    expect(summary.totalCents).toBe(83550);
    expect(summary.byCategory).toEqual([
      { category: 'home', totalCents: 65000 },
      { category: 'insurance', totalCents: 12000 },
      { category: 'bills', totalCents: 4000 },
      { category: 'food', totalCents: 2550 },
    ]);
  });

  it('leaves out forecasts and other months, and gives the previous total', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      transactions: [purchase('t1', '2026-09-30', 1000), purchase('t2', '2026-11-01', 500)],
    });
    expect(summary.items).toEqual([]);
    expect(summary.totalCents).toBe(0);
    expect(summary.previousTotalCents).toBe(1000);
  });

  it('puts expenses without a category and invoices without a contract in "other"', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      invoices: [invoice('i1', 'gone', '2026-10-20', 4000)],
      expenses: [expense()],
    });
    expect(summary.byCategory).toEqual([{ category: 'other', totalCents: 69000 }]);
  });

  it('does not count a purchase whose document was later added as an invoice', () => {
    const stored = invoice('i1', 'light', '2026-10-20', 4000);
    const summary = spendingMonth('2026-10', {
      ...empty,
      contracts: [contract('light', 'electricity')],
      invoices: [stored],
      transactions: [purchase('t1', '2026-10-19', 4000, { docKey: stored.docKey })],
    });
    expect(summary.totalCents).toBe(4000);
    expect(summary.items).toHaveLength(1);
  });

  it('takes refunds off the month and keeps the category when it nets to zero', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      transactions: [purchase('t1', '2026-10-10', 1000), purchase('t2', '2026-10-11', -1000)],
    });
    expect(summary.totalCents).toBe(0);
    expect(summary.byCategory).toEqual([{ category: 'food', totalCents: 0 }]);
  });
});

describe('monthProgress', () => {
  const data: SpendingData = {
    ...empty,
    transactions: [
      purchase('t1', '2026-02-10', 1000),
      purchase('t2', '2026-03-02', 500),
      purchase('t3', '2026-03-02', 250),
      purchase('t4', '2026-03-20', 900),
    ],
  };

  it('stops today in the current month and adds up day by day', () => {
    const progress = monthProgress('2026-03', data, '2026-03-05');
    expect(progress?.current).toEqual([0, 750, 750, 750, 750]);
    expect(progress?.days).toBe(31);
    expect(progress?.previous).toHaveLength(28);
    expect(progress?.previous[9]).toBe(1000);
    expect(progress?.previous[8]).toBe(0);
  });

  it('covers the whole of a past month', () => {
    const progress = monthProgress('2026-03', data, '2026-10-30');
    expect(progress?.current).toHaveLength(31);
    expect(progress?.current[30]).toBe(1650);
  });

  it('has nothing for a month still to come', () => {
    expect(monthProgress('2026-11', data, '2026-10-30')).toBeNull();
  });
});

describe('categoryShare', () => {
  it('is a whole percent of what was spent, ignoring negative categories', () => {
    const byCategory = [
      { category: 'food', totalCents: 7500 },
      { category: 'home', totalCents: 2500 },
      { category: 'other', totalCents: -1000 },
    ] as const;
    expect(categoryShare(7500, [...byCategory])).toBe(75);
    expect(categoryShare(-1000, [...byCategory])).toBe(0);
    expect(categoryShare(0, [])).toBe(0);
  });
});

describe('lastFromIssuer', () => {
  it('finds the newest purchase from a NIF', () => {
    const transactions = [
      purchase('t1', '2026-10-01', 100, { issuerNif: '123456789', description: 'Antiga' }),
      purchase('t2', '2026-10-09', 100, { issuerNif: '123456789', description: 'Nova' }),
      purchase('t3', '2026-10-20', 100, { issuerNif: '500000000' }),
    ];
    expect(lastFromIssuer(transactions, '123456789')?.description).toBe('Nova');
    expect(lastFromIssuer(transactions, '111111111')).toBeUndefined();
  });
});
