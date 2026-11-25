import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import type { CategoryId, Warranty } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { centsToPtInput, parsePtAmount } from '../../lib/money';
import {
  emptyWarrantyFields,
  validateWarrantyFields,
  type WarrantyFieldErrors,
  type WarrantyFieldsValue,
} from '../warranties/save';
import { CategorySelect } from '../categories/CategorySelect';
import { WarrantyFields } from '../warranties/WarrantyFields';
import type { TransactionDraft } from './receipt';

const copy = t.spending;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the purchase's document says beyond its QR code, filled in where nothing was written. */
export interface PurchaseSuggestion {
  seller?: string;
  product?: string;
}

/** The warranty kept with the purchase, or none (an existing one is then removed). */
export type WarrantyChoice = WarrantyFieldsValue | null;

/**
 * A one-off expense to review: a purchase already made or, with "Ainda não
 * está paga", one still to pay. `amountCents` 0 means nothing was written yet.
 */
export function TransactionForm({
  initial,
  warranty,
  file,
  suggestion = {},
  onDone,
}: {
  initial: TransactionDraft;
  /** The warranty already kept with this purchase. */
  warranty?: Warranty;
  /** The document the purchase was read from, kept with its warranty if one is saved. */
  file?: File;
  /** May arrive after the form is open (an AI reading). */
  suggestion?: PurchaseSuggestion;
  onDone: (draft: TransactionDraft | null, warranty?: WarrantyChoice) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    initial.amountCents !== 0 ? centsToPtInput(initial.amountCents) : '',
  );
  const [category, setCategory] = useState<CategoryId>(initial.category);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState(initial.date);
  const [toPay, setToPay] = useState(initial.toPay === true);
  const [keepWarranty, setKeepWarranty] = useState(warranty !== undefined);
  const [warrantyFields, setWarrantyFields] = useState(() => ({
    ...emptyWarrantyFields('', initial.date, warranty),
    ...(file ? { file } : {}),
  }));
  // A suggestion fills what is still empty, or the description still as it was read.
  const [applied, setApplied] = useState<PurchaseSuggestion>({});
  if (suggestion.seller !== applied.seller || suggestion.product !== applied.product) {
    setApplied(suggestion);
    if (suggestion.product && description === initial.description) {
      setDescription(suggestion.product);
    }
    setWarrantyFields({
      ...warrantyFields,
      seller: warrantyFields.seller || suggestion.seller || '',
      product: warrantyFields.product || suggestion.product || '',
    });
  }

  function chooseWarranty(keep: boolean) {
    setKeepWarranty(keep);
    // Ready to confirm: what was bought, where, and when it arrived.
    if (keep) {
      setWarrantyFields({
        ...warrantyFields,
        product:
          warrantyFields.product ||
          suggestion.product ||
          // A description that is the store's name does not say what was bought.
          (description.trim() !== suggestion.seller ? description.trim() : ''),
        seller: warrantyFields.seller || suggestion.seller || '',
      });
    }
  }
  const [errors, setErrors] = useState<{ amount?: string; date?: string } & WarrantyFieldErrors>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const id = initial.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parsePtAmount(amount);
    // The warranty names the purchase unless the user wrote another name for it.
    const fields = {
      ...warrantyFields,
      product: warrantyFields.product.trim() || description.trim(),
    };
    const found: typeof errors = keepWarranty
      ? // Still to pay: the day is when it is due, which can come after the delivery.
        validateWarrantyFields(fields, toPay ? '' : date, t.warranties.errors)
      : {};
    if (amountCents === null || amountCents === 0) found.amount = copy.form.errors.amount;
    if (!DATE.test(date)) found.date = copy.form.errors.date;
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents === null) return;
    const next: TransactionDraft = {
      ...initial,
      amountCents,
      category,
      description: description.trim(),
      date,
    };
    delete next.toPay;
    // Still to pay has no payment day; one paid keeps the day it was ticked.
    if (toPay) {
      next.toPay = true;
      delete next.paidOn;
    } else if (initial.toPay) {
      delete next.paidOn;
    }
    setSaving(true);
    try {
      await onDone(next, keepWarranty ? fields : warranty ? null : undefined);
    } catch {
      setErrors({ ...found, file: t.warranties.errors.file });
    } finally {
      setSaving(false);
    }
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
      <CategorySelect
        id={`spending-category-${id}`}
        label={copy.category}
        value={category}
        onChange={(next) => setCategory(next ?? 'other')}
      />
      <Field
        id={`spending-description-${id}`}
        label={copy.form.description}
        placeholder={copy.form.descriptionPlaceholder}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <label className="month-paid-before">
        <input
          type="checkbox"
          checked={toPay}
          aria-describedby={`spending-to-pay-${id}-hint`}
          onChange={(event) => setToPay(event.target.checked)}
        />
        {copy.form.toPay}
      </label>
      <p id={`spending-to-pay-${id}-hint`} className="field-hint">
        {copy.form.toPayHint}
      </p>
      <Field
        id={`spending-date-${id}`}
        label={toPay ? copy.form.dueDate : copy.form.date}
        type="date"
        value={date}
        error={errors.date}
        onChange={(event) => {
          const value = event.target.value;
          // Delivered the same day unless the user says otherwise.
          if (warrantyFields.deliveryDate === date) {
            setWarrantyFields({ ...warrantyFields, deliveryDate: value });
          }
          setDate(value);
        }}
      />
      <label className="month-paid-before">
        <input
          type="checkbox"
          checked={keepWarranty}
          onChange={(event) => chooseWarranty(event.target.checked)}
        />
        {t.warranties.keep}
      </label>
      {keepWarranty && (
        <fieldset className="month-warranty">
          <legend>{t.warranties.tabs.warranties}</legend>
          <Field
            id={`warranty-product-${id}`}
            label={t.warranties.product}
            placeholder={description || t.warranties.productPlaceholder}
            value={warrantyFields.product}
            error={errors.product}
            onChange={(event) =>
              setWarrantyFields({ ...warrantyFields, product: event.target.value })
            }
          />
          <WarrantyFields
            id={id}
            value={warrantyFields}
            errors={errors}
            hasDocument={warranty?.fileHash !== undefined}
            {...(file ? { readFile: file } : {})}
            withProduct={false}
            onChange={setWarrantyFields}
          />
        </fieldset>
      )}
      <div className="month-actions">
        <button type="submit" className="action-primary" disabled={saving}>
          {copy.form.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => void onDone(null)}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
