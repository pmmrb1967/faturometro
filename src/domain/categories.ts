/**
 * Categories of "Resumo": the app's (fixed, in SPENDING_CATEGORIES) and the
 * ones the user added (Definições), each with a note on what goes in it. Pure.
 */
import { SPENDING_CATEGORIES } from './spending';
import type {
  CategoryId,
  Contract,
  CustomCategory,
  CustomCategoryId,
  Sector,
  SpendingCategory,
} from './types';

export function isAppCategory(id: string): id is SpendingCategory {
  return (SPENDING_CATEGORIES as readonly string[]).includes(id);
}

export function newCategoryId(): CustomCategoryId {
  return `c-${crypto.randomUUID()}`;
}

/** The category as it counts: an unknown one (deleted, maybe on another device) is "other". */
export function knownCategory(
  id: CategoryId | undefined,
  custom: readonly Pick<CustomCategory, 'id'>[],
): CategoryId {
  if (!id) return 'other';
  if (isAppCategory(id)) return id;
  return custom.some((category) => category.id === id) ? id : 'other';
}

/** The order of the lists: the app's, then the user's by name, "Outros" last. */
export function categoryOrder(
  custom: readonly Pick<CustomCategory, 'id' | 'name'>[],
): CategoryId[] {
  const own = [...custom]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map((category) => category.id);
  return [...SPENDING_CATEGORIES.filter((id) => id !== 'other'), ...own, 'other'];
}

const SECTOR_CATEGORY: Record<Sector, SpendingCategory> = {
  telecom: 'bills',
  electricity: 'bills',
  gas: 'bills',
  water: 'bills',
  insurance: 'insurance',
  transport: 'transport',
  other: 'other',
};

/** A contract's invoices: in the category the user chose for it, or in its sector's. */
export function contractCategory(contract: Pick<Contract, 'sector' | 'category'>): CategoryId {
  return contract.category ?? SECTOR_CATEGORY[contract.sector];
}
