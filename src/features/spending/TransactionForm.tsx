import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { SPENDING_CATEGORIES } from '../../domain/spending';
import type { SpendingCategory } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { centsToPtInput, parsePtAmount } from '../../lib/money';
import type { TransactionDraft } from './receipt';

const copy = t.spending;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A purchase to review: `amountCents` 0 means nothing was written yet. */
export function TransactionForm({
  initial,
  onDone,
}: {
  initial: TransactionDraft;
  onDone: (draft: TransactionDraft | null) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    initial.amountCents !== 0 ? centsToPtInput(initial.amountCents) : '',
  );
  const [category, setCategory] = useState<SpendingCategory>(initial.category);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState(initial.date);
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const id = initial.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parsePtAmount(amount);
    const found: typeof errors = {};
    if (amountCents === null || amountCents === 0) found.amount = copy.form.errors.amount;
    if (!DATE.test(date)) found.date = copy.form.errors.date;
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    await onDone({ ...initial, amountCents, category, description: description.trim(), date });
  }

  return (
    <form className="month-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        id={`spending-amount-${id}`}
        label={copy.form.amount}
        inputMode="decimal"
        value={amount}
        error={errors.amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <SelectField
        id={`spending-category-${id}`}
        label={copy.category}
        value={category}
        onChange={(event) => setCategory(event.target.value as SpendingCategory)}
      >
        {SPENDING_CATEGORIES.map((item) => (
          <option key={item} value={item}>
            {copy.categories[item]}
          </option>
        ))}
      </SelectField>
      <Field
        id={`spending-description-${id}`}
        label={copy.form.description}
        placeholder={copy.form.descriptionPlaceholder}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Field
        id={`spending-date-${id}`}
        label={copy.form.date}
        type="date"
        value={date}
        error={errors.date}
        onChange={(event) => setDate(event.target.value)}
      />
      <div className="month-actions">
        <button type="submit" className="action-primary">
          {copy.form.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => void onDone(null)}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
