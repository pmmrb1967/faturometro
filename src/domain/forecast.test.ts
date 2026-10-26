import { describe, expect, it } from 'vitest';
import { forecastInvoices } from './forecast';
import { monthSummary } from './month';
import type { Contract, Invoice } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    ...META,
    id: 'c1',
    providerId: 'p1',
    sector: 'telecom',
    label: 'Internet',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function invoice(
  id: string,
  issueDate: string,
  totalCents: number,
  extra: Partial<Invoice> = {},
): Invoice {
  return {
    ...META,
    id,
    contractId: 'c1',
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate,
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${issueDate}T10:00:00.000Z`,
    ...extra,
  };
}

const monthly = [
  invoice('a', '2026-08-05', 4999, { dueDate: '2026-08-20' }),
  invoice('b', '2026-09-05', 4999, { dueDate: '2026-09-20' }),
  invoice('c', '2026-10-05', 5199, { dueDate: '2026-10-20' }),
];

describe('forecastInvoices', () => {
  it('the next invoices at the usual rhythm, on the same day of the month, for 12 months', () => {
    const forecasts = forecastInvoices([contract()], monthly, '2026-10-26');
    expect(forecasts.map((forecast) => forecast.date)).toEqual([
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
      '2027-02-20',
      '2027-03-20',
      '2027-04-20',
      '2027-05-20',
      '2027-06-20',
      '2027-07-20',
      '2027-08-20',
      '2027-09-20',
      '2027-10-20',
    ]);
    // Fixed-price sectors: the latest invoice.
    expect(forecasts[0]).toMatchObject({
      contractId: 'c1',
      issueDate: '2026-11-05',
      hasDueDate: true,
      debit: false,
      amountCents: 5199,
    });
  });

  it('two invoices are enough; without a due date, the issue date', () => {
    const forecasts = forecastInvoices(
      [contract()],
      [invoice('a', '2026-09-05', 1000), invoice('b', '2026-10-05', 1000)],
      '2026-10-26',
      1,
    );
    expect(forecasts).toEqual([
      {
        contractId: 'c1',
        issueDate: '2026-11-05',
        date: '2026-11-05',
        hasDueDate: false,
        debit: false,
        amountCents: 1000,
      },
    ]);
  });

  it('nothing with a single invoice, or for a contract that ended', () => {
    expect(forecastInvoices([contract()], monthly.slice(-1), '2026-10-26')).toEqual([]);
    expect(forecastInvoices([contract({ active: false })], monthly, '2026-10-26')).toEqual([]);
  });

  it('includes this month when the invoice has not come yet', () => {
    const forecasts = forecastInvoices([contract()], monthly.slice(0, 2), '2026-10-26', 0);
    expect(forecasts.map((forecast) => forecast.date)).toEqual(['2026-10-20']);
  });

  it('direct debit: the debit day, from the invoices or from the contract', () => {
    const printed = monthly.map((item) => ({
      ...item,
      directDebitDate: `${item.issueDate.slice(0, 8)}23`,
    }));
    expect(forecastInvoices([contract()], printed, '2026-10-26', 1)[0]).toMatchObject({
      date: '2026-11-23',
      debit: true,
    });
    expect(
      forecastInvoices([contract({ directDebit: true })], monthly, '2026-10-26', 1)[0],
    ).toMatchObject({ date: '2026-11-20', debit: true });
  });

  it('consumption sectors: the invoice from the same time last year, else the latest average', () => {
    const electricity = contract({ sector: 'electricity' });
    const invoices = [
      invoice('w', '2025-11-04', 9000),
      invoice('x', '2026-08-05', 4000),
      invoice('y', '2026-09-05', 4200),
      invoice('z', '2026-10-05', 4500),
    ];
    const [november, december] = forecastInvoices([electricity], invoices, '2026-10-26', 2);
    expect(november?.amountCents).toBe(9000);
    // (4000 + 4200 + 4500) / 3, rounded to the cent.
    expect(december?.amountCents).toBe(4233);
  });

  it('credit notes are neither bills nor part of the rhythm', () => {
    const forecasts = forecastInvoices(
      [contract()],
      [...monthly, invoice('nc', '2026-10-20', -500)],
      '2026-10-26',
      1,
    );
    expect(forecasts[0]).toMatchObject({ issueDate: '2026-11-05', amountCents: 5199 });
  });

  it('a rhythm that is not whole months goes by days', () => {
    const forecasts = forecastInvoices(
      [contract()],
      [invoice('a', '2026-09-01', 1000), invoice('b', '2026-09-15', 1000)],
      '2026-09-20',
      0,
    );
    expect(forecasts.map((forecast) => forecast.issueDate)).toEqual(['2026-09-29']);
  });
});

describe('forecasts in the month', () => {
  it('count in the total and in what is left to pay, never as paid', () => {
    const forecasts = forecastInvoices([contract()], monthly.slice(0, 2), '2026-10-26');
    const october = monthSummary('2026-10', monthly.slice(0, 2), [], [], {
      today: '2026-10-26',
      forecasts,
    });
    expect(october.items).toEqual([
      {
        paymentId: 'forecast-c1-2026-10-05',
        kind: 'forecast',
        contractId: 'c1',
        date: '2026-10-20',
        hasDueDate: true,
        amountCents: 4999,
        late: true,
      },
    ]);
    expect(october).toMatchObject({ totalCents: 4999, toPayCents: 4999, forecastCents: 4999 });
  });

  it('the real invoice takes the place of its forecast', () => {
    const forecasts = forecastInvoices([contract()], monthly, '2026-10-26');
    const october = monthSummary('2026-10', monthly, [], [], { today: '2026-10-26', forecasts });
    expect(october.items.map((item) => item.kind)).toEqual(['invoice']);
    expect(october.forecastCents).toBe(0);
  });
});
