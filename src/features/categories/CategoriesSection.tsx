import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { categoryOrder, isAppCategory } from '../../domain/categories';
import type { CustomCategory } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { SettingsBlock } from '../settings/SettingsBlock';
import '../month/month.css';
import '../spending/spending.css';
import { categoryUses, removeCategory, saveCategory } from './save';
import { categoryName, useCustomCategories } from './use-categories';

const copy = t.categories;
const MAX_NAME = 40;

/** Definições → Categorias: the app's, with what goes in each, and the user's own. */
export function CategoriesSection() {
  const custom = useCustomCategories();
  const [editing, setEditing] = useState<string | null>(null);
  if (!custom) return null;
  const own = [...custom].sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  return (
    <SettingsBlock id="categorias" title={copy.title} status={copy.status(own.length)}>
      <p className="muted">{copy.intro}</p>
      <details className="spending-help">
        <summary>{copy.appTitle}</summary>
        <dl>
          {categoryOrder([])
            .filter(isAppCategory)
            .map((category) => (
              <div key={category}>
                <dt>{t.spending.categories[category]}</dt>
                <dd>{t.spending.help.category[category]}</dd>
              </div>
            ))}
        </dl>
      </details>

      <h3>{copy.ownTitle}</h3>
      {own.length === 0 && <p className="muted">{copy.empty}</p>}
      <ul className="list">
        {own.map((category) =>
          editing === category.id ? (
            <li key={category.id}>
              <CategoryForm existing={category} others={custom} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <CategoryItem
              key={category.id}
              category={category}
              onEdit={() => setEditing(category.id)}
            />
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <CategoryForm others={custom} onDone={() => setEditing(null)} />
      ) : (
        <p>
          <button type="button" className="action-secondary" onClick={() => setEditing('new')}>
            {copy.add}
          </button>
        </p>
      )}
    </SettingsBlock>
  );
}

function CategoryItem({ category, onEdit }: { category: CustomCategory; onEdit: () => void }) {
  const { session } = useSession();
  const [uses, setUses] = useState<number | null>(null);
  if (!session) return null;
  const repos = session.repos;

  return (
    <li className="list-item month-expense">
      <strong>{category.name}</strong>
      {category.note && <span className="meta">{category.note}</span>}
      {uses !== null ? (
        <div className="month-confirm" role="alert">
          <p>{copy.confirmRemove(category.name, uses)}</p>
          <div className="month-actions">
            <button
              type="button"
              className="action-secondary danger"
              onClick={() => void removeCategory(repos, category.id)}
            >
              {copy.confirm}
            </button>
            <button type="button" className="action-secondary" onClick={() => setUses(null)}>
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="month-actions">
          <button type="button" className="action-secondary" onClick={onEdit}>
            {copy.edit}
          </button>
          <button
            type="button"
            className="action-secondary danger"
            aria-label={`${copy.remove}: ${category.name}`}
            onClick={() => void categoryUses(repos, category.id).then(setUses)}
          >
            {copy.remove}
          </button>
        </div>
      )}
    </li>
  );
}

function CategoryForm({
  existing,
  others,
  onDone,
}: {
  existing?: CustomCategory;
  others: readonly CustomCategory[];
  onDone: () => void;
}) {
  const { session } = useSession();
  const [name, setName] = useState(existing?.name ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const id = existing?.id ?? 'new';
  if (!session) return null;
  const repos = session.repos;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const taken = [
      ...categoryOrder([]).map((category) => categoryName(category, [])),
      ...others.filter((category) => category.id !== existing?.id).map((category) => category.name),
    ].some((other) => other.localeCompare(trimmed, 'pt', { sensitivity: 'base' }) === 0);
    const problem = !trimmed
      ? copy.errors.name
      : trimmed.length > MAX_NAME
        ? copy.errors.long(MAX_NAME)
        : taken
          ? copy.errors.taken
          : undefined;
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      await saveCategory(repos, { name: trimmed, note }, existing);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="month-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        id={`category-name-${id}`}
        label={copy.name}
        placeholder={copy.namePlaceholder}
        value={name}
        error={error}
        maxLength={MAX_NAME}
        onChange={(event) => setName(event.target.value)}
      />
      <Field
        id={`category-note-${id}`}
        label={copy.note}
        hint={copy.noteHint}
        placeholder={copy.notePlaceholder}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="month-actions">
        <button type="submit" className="action-primary" disabled={saving}>
          {copy.save}
        </button>
        <button type="button" className="action-secondary" onClick={onDone}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
