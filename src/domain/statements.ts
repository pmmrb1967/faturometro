/**
 * A statement with several invoices on the same day (Via Verde: one per
 * issuer) is one bill: the invoices of a day are added up, on the data of the
 * first one. Used for usage-based contracts, whose bill is the statement.
 */
import type { Cents } from '../lib/money';

export function statementBills<T extends { issueDate: string; totalCents: Cents }>(
  invoices: readonly T[],
): T[] {
  const sorted = [...invoices].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const bills: T[] = [];
  for (const invoice of sorted) {
    const last = bills.at(-1);
    if (last && last.issueDate === invoice.issueDate) {
      bills[bills.length - 1] = { ...last, totalCents: last.totalCents + invoice.totalCents };
    } else {
      bills.push(invoice);
    }
  }
  return bills;
}
