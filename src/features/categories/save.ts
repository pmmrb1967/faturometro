import type { Repositories } from '../../db/repositories';
import { newCategoryId } from '../../domain/categories';
import type { CustomCategory, CustomCategoryId } from '../../domain/types';

/** A new category, or a change to one; a note left empty is removed. */
export async function saveCategory(
  repos: Pick<Repositories, 'categories'>,
  value: { name: string; note: string },
  existing?: CustomCategory,
): Promise<CustomCategoryId> {
  const id = existing?.id ?? newCategoryId();
  const next: Omit<CustomCategory, 'updatedAt'> = {
    id,
    name: value.name.trim(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const note = value.note.trim();
  if (note) next.note = note;
  await repos.categories.put(next);
  return id;
}

/**
 * Deletes a category: what used it goes to "Outros" (purchases and recurring
 * expenses) or back to its sector's (contracts). Returns how many moved.
 */
export async function removeCategory(
  repos: Pick<Repositories, 'categories' | 'transactions' | 'expenses' | 'contracts'>,
  id: CustomCategoryId,
): Promise<number> {
  let moved = 0;
  for (const transaction of await repos.transactions.list()) {
    if (transaction.category !== id) continue;
    await repos.transactions.put({ ...transaction, category: 'other' });
    moved += 1;
  }
  for (const expense of await repos.expenses.list()) {
    if (expense.category !== id) continue;
    await repos.expenses.put({ ...expense, category: 'other' });
    moved += 1;
  }
  for (const contract of await repos.contracts.list()) {
    if (contract.category !== id) continue;
    const next = { ...contract };
    delete next.category;
    await repos.contracts.put(next);
    moved += 1;
  }
  await repos.categories.remove(id);
  return moved;
}

/** How many expenses and contracts use a category (said before deleting it). */
export async function categoryUses(
  repos: Pick<Repositories, 'transactions' | 'expenses' | 'contracts'>,
  id: CustomCategoryId,
): Promise<number> {
  const [transactions, expenses, contracts] = await Promise.all([
    repos.transactions.list(),
    repos.expenses.list(),
    repos.contracts.list(),
  ]);
  return [...transactions, ...expenses, ...contracts].filter((row) => row.category === id).length;
}
