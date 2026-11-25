import type { Repositories } from '../../db/repositories';
import type { Warranty } from '../../domain/types';
import type { TransactionDraft } from '../spending/receipt';
import type { WarrantyChoice } from '../spending/TransactionForm';
import { removeWarranty, saveWarranty } from '../warranties/save';

/**
 * Stores a one-off expense and what the user chose for its warranty: kept
 * (with the purchase's day and amount), removed, or left as it was.
 */
export async function saveOneOff(
  repos: Repositories,
  draft: TransactionDraft,
  choice: WarrantyChoice | undefined,
  existing: Warranty | undefined,
): Promise<void> {
  await repos.transactions.put({
    ...draft,
    createdAt: draft.createdAt ?? new Date().toISOString(),
  });
  if (choice) {
    await saveWarranty(repos, {
      existing,
      value: choice,
      // Something still to pay may have been delivered before it is due.
      purchaseDate: choice.deliveryDate < draft.date ? choice.deliveryDate : draft.date,
      priceCents: draft.amountCents,
      transactionId: draft.id,
    });
  } else if (choice === null && existing) {
    await removeWarranty(repos, existing.id);
  }
}
