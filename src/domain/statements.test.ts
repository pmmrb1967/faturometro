import { describe, expect, it } from 'vitest';
import { statementBills } from './statements';

describe('statementBills', () => {
  it('adds up the invoices of the same day, in date order', () => {
    const bills = statementBills([
      { id: 'b', issueDate: '2026-09-30', totalCents: 300 },
      { id: 'a1', issueDate: '2026-08-31', totalCents: 2000 },
      { id: 'a2', issueDate: '2026-08-31', totalCents: 400 },
    ]);
    expect(bills).toEqual([
      { id: 'a1', issueDate: '2026-08-31', totalCents: 2400 },
      { id: 'b', issueDate: '2026-09-30', totalCents: 300 },
    ]);
  });
});
