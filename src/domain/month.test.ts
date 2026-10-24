import { describe, expect, it } from 'vitest';
import {
  addMonthsTo,
  debitDateOf,
  expenseActive,
  expenseAmount,
  expenseDueDate,
  invoicePaid,
  monthSummary,
  paymentId,
  uncheckAction,
  withAmountFrom,
} from './month';
import type { Invoice, Payment, RecurringExpense } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function invoice(id: string, issueDate: string, totalCents: number, dueDate?: string): Invoice {
  return {
    ...META,
    id,
    contractId: 'c1',
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate,
    ...(dueDate ? { dueDate } : {}),
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${issueDate}T10:00:00.000Z`,
  };
}

function expense(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    ...META,
    id: 'e1',
    name: 'Renda',
    amountCents: 65000,
    everyMonths: 1,
    dueDay: 8,
    startMonth: '2026-01',
    createdAt: META.updatedAt,
    ...overrides,
  };
}

const paid = (id: string, paidOn = '2026-10-05'): Payment => ({ ...META, id, paidOn });

describe('addMonthsTo', () => {
  it('moves across years', () => {
    expect(addMonthsTo('2026-12', 1)).toBe('2027-01');
    expect(addMonthsTo('2026-01', -1)).toBe('2025-12');
    expect(addMonthsTo('2026-10', 14)).toBe('2027-12');
  });
});

describe('expenseDueDate', () => {
  it('in the months it is due, from the start and up to the end', () => {
    const quarterly = expense({ everyMonths: 3, startMonth: '2026-02', endMonth: '2026-11' });
    expect(expenseDueDate(quarterly, '2026-01')).toBeNull();
    expect(expenseDueDate(quarterly, '2026-02')).toBe('2026-02-08');
    expect(expenseDueDate(quarterly, '2026-03')).toBeNull();
    expect(expenseDueDate(quarterly, '2026-11')).toBe('2026-11-08');
    expect(expenseDueDate(quarterly, '2027-02')).toBeNull();
  });

  it('every four months, counted from the first month', () => {
    const fourMonthly = expense({ everyMonths: 4, startMonth: '2026-01' });
    const due = Array.from({ length: 12 }, (_, i) => addMonthsTo('2026-01', i)).filter(
      (month) => expenseDueDate(fourMonthly, month) !== null,
    );
    expect(due).toEqual(['2026-01', '2026-05', '2026-09']);
  });

  it('a one-off expense only in its month', () => {
    const fridge = expense({ oneOff: true, startMonth: '2026-10', endMonth: '2026-10' });
    expect(expenseDueDate(fridge, '2026-09')).toBeNull();
    expect(expenseDueDate(fridge, '2026-10')).toBe('2026-10-08');
    expect(expenseDueDate(fridge, '2026-11')).toBeNull();
  });

  it('uses the last day of shorter months', () => {
    expect(expenseDueDate(expense({ dueDay: 31 }), '2026-02')).toBe('2026-02-28');
  });
});

describe('expenseActive', () => {
  it('only between the first and the last month', () => {
    const condominium = expense({ startMonth: '2026-03', endMonth: '2026-09' });
    expect(expenseActive(condominium, '2026-02')).toBe(false);
    expect(expenseActive(condominium, '2026-03')).toBe(true);
    expect(expenseActive(condominium, '2026-09')).toBe(true);
    expect(expenseActive(condominium, '2026-10')).toBe(false);
    expect(expenseActive(expense({ startMonth: '2026-03' }), '2030-01')).toBe(true);
  });
});

describe('amount changes', () => {
  it('a new amount from a month on; earlier months keep theirs', () => {
    const rent = withAmountFrom(expense({ amountCents: 65000 }), '2027-01', 67000);
    expect(expenseAmount(rent, '2026-12')).toBe(65000);
    expect(expenseAmount(rent, '2027-01')).toBe(67000);
    const again = withAmountFrom(rent, '2028-01', 69000);
    expect(expenseAmount(again, '2027-06')).toBe(67000);
    expect(expenseAmount(again, '2028-03')).toBe(69000);
    expect(monthSummary('2028-01', [], [again], []).totalCents).toBe(69000);
  });

  it('replaces the changes from that month on, and the base from the first month', () => {
    const rent = withAmountFrom(
      withAmountFrom(expense({ amountCents: 65000 }), '2027-01', 67000),
      '2026-06',
      66000,
    );
    expect(rent.amountChanges).toEqual([{ fromMonth: '2026-06', amountCents: 66000 }]);
    const fixed = withAmountFrom(rent, '2026-01', 60000);
    expect(fixed.amountCents).toBe(60000);
    expect(fixed.amountChanges).toBeUndefined();
  });
});

describe('monthSummary', () => {
  it('invoices by due date (else issue date), expenses, and what is paid', () => {
    const invoices = [
      invoice('a', '2026-09-23', 4999, '2026-10-08'),
      invoice('b', '2026-10-02', 3000),
      invoice('c', '2026-10-25', 2000, '2026-11-09'),
      invoice('nc', '2026-10-12', -500),
    ];
    const summary = monthSummary(
      '2026-10',
      invoices,
      [expense()],
      [paid(paymentId({ invoiceId: 'a' })), paid(paymentId({ expenseId: 'e1', month: '2026-09' }))],
    );
    expect(summary.items.map((item) => [item.paymentId, item.date, item.paidOn])).toEqual([
      ['invoice-b', '2026-10-02', undefined],
      ['expense-e1-2026-10', '2026-10-08', undefined],
      ['invoice-a', '2026-10-08', '2026-10-05'],
      ['invoice-nc', '2026-10-12', undefined],
    ]);
    expect(summary.items.find((item) => item.invoiceId === 'b')?.hasDueDate).toBe(false);
    expect(summary).toMatchObject({ totalCents: 72499, paidCents: 4999, toPayCents: 67500 });
  });
});

describe('direct debit', () => {
  const debited = {
    ...invoice('d', '2026-10-01', 5051, '2026-10-20'),
    directDebitDate: '2026-10-23',
  };

  it('the debit date printed on the invoice, else the due date on a contract marked by the user', () => {
    expect(debitDateOf(debited)).toBe('2026-10-23');
    expect(debitDateOf(invoice('x', '2026-10-01', 100, '2026-10-20'))).toBeUndefined();
    expect(debitDateOf(invoice('x', '2026-10-01', 100, '2026-10-20'), { directDebit: true })).toBe(
      '2026-10-20',
    );
  });

  it('paid automatically from the debit day, unless the user said it failed', () => {
    expect(invoicePaid(undefined, '2026-10-23', '2026-10-22')).toBeNull();
    expect(invoicePaid(undefined, '2026-10-23', '2026-10-23')).toEqual({
      paidOn: '2026-10-23',
      auto: true,
    });
    expect(invoicePaid({ unpaid: true }, '2026-10-23', '2026-10-30')).toBeNull();
    expect(invoicePaid({ paidOn: '2026-10-21' }, '2026-10-23', '2026-10-30')).toEqual({
      paidOn: '2026-10-21',
      auto: false,
    });
  });

  it('unticking says the debit failed only for a mark the app made', () => {
    expect(uncheckAction({ autoPaid: true })).toBe('unpaid');
    // The user's own mark is removed; the direct debit marks it again.
    expect(uncheckAction({})).toBe('remove');
    const summary = monthSummary('2026-10', [debited], [], [], { today: '2026-10-30' });
    expect(summary.items[0]).toMatchObject({ paidOn: '2026-10-23', autoPaid: true });
  });

  it('shows on the month of the debit, paid once it has passed', () => {
    const before = monthSummary('2026-10', [debited], [], [], { today: '2026-10-22' });
    expect(before.items[0]).toMatchObject({ date: '2026-10-23', debitDate: '2026-10-23' });
    expect(before.items[0]?.paidOn).toBeUndefined();
    const after = monthSummary('2026-10', [debited], [], [], { today: '2026-10-24' });
    expect(after.items[0]).toMatchObject({ paidOn: '2026-10-23', autoPaid: true });
    expect(after.paidCents).toBe(5051);
  });
});
