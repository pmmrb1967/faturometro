import { SelectField } from '../../components/Field';
import { categoryOrder, knownCategory } from '../../domain/categories';
import type { CategoryId } from '../../domain/types';
import { categoryName, categoryNote, useCustomCategories } from './use-categories';

/** Choosing a category, the app's or the user's, with what goes in it under the field. */
export function CategorySelect({
  id,
  label,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  label: string;
  /** Undefined: the empty choice (`emptyLabel`), e.g. "from the sector" on a contract. */
  value: CategoryId | undefined;
  onChange: (value: CategoryId | undefined) => void;
  emptyLabel?: string;
}) {
  const custom = useCustomCategories() ?? [];
  const shown = value === undefined ? undefined : knownCategory(value, custom);
  return (
    <SelectField
      id={id}
      label={label}
      hint={shown === undefined ? undefined : categoryNote(shown, custom) || undefined}
      value={shown ?? ''}
      onChange={(event) =>
        onChange(event.target.value ? (event.target.value as CategoryId) : undefined)
      }
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {categoryOrder(custom).map((category) => (
        <option key={category} value={category}>
          {categoryName(category, custom)}
        </option>
      ))}
    </SelectField>
  );
}
