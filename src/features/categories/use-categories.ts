import { useLiveQuery } from 'dexie-react-hooks';
import type { CategoryId, CustomCategory } from '../../domain/types';
import { isAppCategory } from '../../domain/categories';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';

/** The user's categories, kept up to date (undefined while loading). */
export function useCustomCategories(): CustomCategory[] | undefined {
  const { session } = useSession();
  return useLiveQuery(async () => (session ? session.repos.categories.list() : []), [session]);
}

/** A category's name; an unknown one (deleted) is "Outros". */
export function categoryName(id: CategoryId, custom: readonly CustomCategory[]): string {
  if (isAppCategory(id)) return t.spending.categories[id];
  return custom.find((category) => category.id === id)?.name ?? t.spending.categories.other;
}

/** What goes in a category: the app's note, or the one the user wrote. */
export function categoryNote(id: CategoryId, custom: readonly CustomCategory[]): string {
  if (isAppCategory(id)) return t.spending.help.category[id];
  return custom.find((category) => category.id === id)?.note ?? '';
}
