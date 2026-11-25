import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import type { DocumentSyncState } from '../../db/schema';
import type { Warranty } from '../../domain/types';
import { warrantyStatus } from '../../domain/warranty';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { OriginalButton } from '../invoices/OriginalButton';
import '../invoices/invoices.css';
import '../month/month.css';
import {
  emptyWarrantyFields,
  removeWarranty,
  saveWarranty,
  validateWarrantyFields,
  type WarrantyFieldErrors,
} from './save';
import { useWarranties } from './use-warranties';
import { WarrantyFields } from './WarrantyFields';

const copy = t.warranties;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The tab "Garantias" of Contratos: each purchase's legal warranty and its document. */
export function WarrantiesView() {
  const data = useWarranties();
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  if (!data) return null;
  const date = today();

  return (
    <>
      <p className="muted">
        {copy.intro}{' '}
        <a
          href="https://diariodarepublica.pt/dr/detalhe/decreto-lei/84-2021-172938301"
          target="_blank"
          rel="noreferrer"
        >
          {copy.source}
        </a>
      </p>
      {notice && (
        <p role="status" className="doc-saved">
          {copy.saved}
        </p>
      )}
      {editing === 'new' ? (
        <WarrantyForm
          onDone={(saved) => {
            setEditing(null);
            setNotice(saved);
          }}
        />
      ) : (
        <p>
          <button
            type="button"
            className="action-primary"
            onClick={() => {
              setNotice(false);
              setEditing('new');
            }}
          >
            {copy.add}
          </button>
        </p>
      )}
      {data.warranties.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <ul className="list">
          {data.warranties.map((warranty) =>
            editing === warranty.id ? (
              <li key={warranty.id}>
                <WarrantyForm
                  initial={warranty}
                  onDone={(saved) => {
                    setEditing(null);
                    setNotice(saved);
                  }}
                />
              </li>
            ) : (
              <WarrantyItem
                key={warranty.id}
                warranty={warranty}
                state={warranty.fileHash ? data.states.get(warranty.fileHash) : undefined}
                today={date}
                onEdit={() => {
                  setNotice(false);
                  setEditing(warranty.id);
                }}
              />
            ),
          )}
        </ul>
      )}
    </>
  );
}

function WarrantyItem({
  warranty,
  state,
  today: date,
  onEdit,
}: {
  warranty: Warranty;
  state: DocumentSyncState | undefined;
  today: string;
  onEdit: () => void;
}) {
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const status = warrantyStatus(warranty, date);
  const end = formatIsoDate(status.endDate);

  return (
    <li className="list-item">
      <strong>{warranty.product}</strong>
      {warranty.priceCents !== undefined && (
        <span className="amount">{formatCents(warranty.priceCents)}</span>
      )}
      <span className="meta">
        {[
          status.state === 'ended'
            ? copy.endedOn(end)
            : `${copy.until(end)} (${copy.daysLeft(status.daysLeft)})`,
          warranty.seller,
          copy.delivered(formatIsoDate(warranty.deliveryDate)),
          warranty.fileHash ? undefined : copy.noDocument,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span
        className={`list-badge${status.state === 'ending' ? ' is-warning' : ''}${status.state === 'ended' ? ' is-question' : ''}`}
      >
        {copy.states[status.state]}
      </span>
      {warranty.notes && <span className="meta">{warranty.notes}</span>}
      {warranty.fileHash && state && state !== 'gone' && (
        <OriginalButton fileHash={warranty.fileHash} state={state} />
      )}
      {confirming ? (
        <div className="month-confirm" role="alert">
          <p>{copy.confirmRemove(warranty.product)}</p>
          <div className="month-actions">
            <button
              type="button"
              className="action-secondary danger"
              onClick={() => void removeWarranty(session.repos, warranty.id)}
            >
              {copy.confirm}
            </button>
            <button type="button" className="action-secondary" onClick={() => setConfirming(false)}>
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
            aria-label={`${copy.remove}: ${warranty.product}`}
            onClick={() => setConfirming(true)}
          >
            {copy.remove}
          </button>
        </div>
      )}
    </li>
  );
}

/** A warranty typed on its own (a purchase not registered in "Este mês"). */
function WarrantyForm({
  initial,
  onDone,
}: {
  initial?: Warranty;
  onDone: (saved: boolean) => void;
}) {
  const { session } = useSession();
  const date = today();
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate ?? date);
  const [price, setPrice] = useState(
    initial?.priceCents !== undefined ? centsToPtInput(initial.priceCents) : '',
  );
  const [fields, setFields] = useState(() => emptyWarrantyFields('', date, initial));
  const [errors, setErrors] = useState<
    WarrantyFieldErrors & { purchaseDate?: string; price?: string }
  >({});
  const [saving, setSaving] = useState(false);
  const id = initial?.id ?? 'new';
  if (!session) return null;
  const repos = session.repos;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = price.trim() ? parsePtAmount(price) : undefined;
    const found: typeof errors = validateWarrantyFields(fields, purchaseDate, copy.errors);
    if (!DATE.test(purchaseDate)) found.purchaseDate = copy.errors.date;
    if (priceCents === null || (priceCents !== undefined && priceCents < 0)) {
      found.price = copy.errors.price;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || priceCents === null) return;
    setSaving(true);
    try {
      await saveWarranty(repos, {
        existing: initial,
        value: fields,
        purchaseDate,
        ...(priceCents !== undefined ? { priceCents } : {}),
      });
      onDone(true);
    } catch {
      setErrors({ ...found, file: copy.errors.file });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="month-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        id={`warranty-product-${id}`}
        label={copy.product}
        placeholder={copy.productPlaceholder}
        value={fields.product}
        error={errors.product}
        onChange={(event) => setFields({ ...fields, product: event.target.value })}
      />
      <Field
        id={`warranty-purchase-${id}`}
        label={copy.purchaseDate}
        type="date"
        value={purchaseDate}
        error={errors.purchaseDate}
        onChange={(event) => {
          const next = event.target.value;
          // Delivered the same day unless the user says otherwise.
          if (fields.deliveryDate === purchaseDate) setFields({ ...fields, deliveryDate: next });
          setPurchaseDate(next);
        }}
      />
      <Field
        id={`warranty-price-${id}`}
        label={copy.price}
        inputMode="decimal"
        value={price}
        error={errors.price}
        onChange={(event) => setPrice(event.target.value)}
      />
      <WarrantyFields
        id={id}
        value={fields}
        errors={errors}
        hasDocument={initial?.fileHash !== undefined}
        withProduct={false}
        onChange={setFields}
      />
      <div className="month-actions">
        <button type="submit" className="action-primary" disabled={saving}>
          {copy.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => onDone(false)}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
