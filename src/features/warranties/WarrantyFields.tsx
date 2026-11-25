import { useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import type { WarrantyFieldErrors, WarrantyFieldsValue, WarrantyTerm } from './save';

const copy = t.warranties;
const TERMS: readonly WarrantyTerm[] = ['new', 'usedAgreed', 'other'];

/** The warranty part of a form: what, where, when delivered, for how long, and the document. */
export function WarrantyFields({
  id,
  value,
  errors,
  hasDocument,
  withProduct = true,
  readFile,
  onChange,
}: {
  id: string;
  value: WarrantyFieldsValue;
  errors: WarrantyFieldErrors;
  /** A document is already kept with this warranty. */
  hasDocument: boolean;
  /** False inside the purchase form, where the description names it unless changed. */
  withProduct?: boolean;
  /** The photo or PDF the purchase was read from: kept unless another is chosen. */
  readFile?: File;
  onChange: (value: WarrantyFieldsValue) => void;
}) {
  const [otherFile, setOtherFile] = useState(false);
  const set = <K extends keyof WarrantyFieldsValue>(key: K, next: WarrantyFieldsValue[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <>
      {withProduct && (
        <Field
          id={`warranty-product-${id}`}
          label={copy.product}
          placeholder={copy.productPlaceholder}
          value={value.product}
          error={errors.product}
          onChange={(event) => set('product', event.target.value)}
        />
      )}
      <Field
        id={`warranty-seller-${id}`}
        label={copy.seller}
        value={value.seller}
        onChange={(event) => set('seller', event.target.value)}
      />
      <Field
        id={`warranty-delivery-${id}`}
        label={copy.deliveryDate}
        hint={copy.deliveryHint}
        type="date"
        value={value.deliveryDate}
        error={errors.deliveryDate}
        onChange={(event) => set('deliveryDate', event.target.value)}
      />
      <SelectField
        id={`warranty-term-${id}`}
        label={copy.term}
        value={value.term}
        onChange={(event) => set('term', event.target.value as WarrantyTerm)}
      >
        {TERMS.map((term) => (
          <option key={term} value={term}>
            {copy.terms[term]}
          </option>
        ))}
      </SelectField>
      {value.term === 'other' && (
        <Field
          id={`warranty-months-${id}`}
          label={copy.otherMonths}
          hint={copy.otherHint}
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          value={value.otherMonths}
          error={errors.otherMonths}
          onChange={(event) => set('otherMonths', event.target.value)}
        />
      )}
      {readFile && !otherFile ? (
        <p className="muted">
          {copy.fileFromReading(readFile.name)}{' '}
          <button type="button" className="link-button" onClick={() => setOtherFile(true)}>
            {copy.otherFile}
          </button>
        </p>
      ) : (
        <Field
          id={`warranty-file-${id}`}
          label={copy.file}
          hint={hasDocument ? copy.fileKept : copy.fileHint}
          type="file"
          accept="application/pdf,image/*"
          error={errors.file}
          // Back to the file read, unless another one is chosen.
          onChange={(event) => set('file', event.target.files?.[0] ?? readFile ?? null)}
        />
      )}
      {readFile && !otherFile && errors.file && (
        <p className="ingest-problem" role="alert">
          {errors.file}
        </p>
      )}
      <Field
        id={`warranty-notes-${id}`}
        label={copy.notes}
        value={value.notes}
        onChange={(event) => set('notes', event.target.value)}
      />
    </>
  );
}
