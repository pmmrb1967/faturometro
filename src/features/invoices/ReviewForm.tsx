import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { isValidNif } from '../../domain/nif';
import type { Sector } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { docKeyFor } from '../ingest/ingest';
import { refreshAlerts } from '../alerts/refresh';
import { getSettings } from '../settings/settings';
import {
  SECTORS,
  buildDraft,
  defaultContractId,
  type FormBase,
  type FormErrors,
  type InvoiceForm,
  type LockedFields,
} from './form';
import { DuplicateInvoiceError, saveInvoice } from './save';
import './invoices.css';

const copy = t.invoices;

interface Props {
  base: FormBase;
  initial: InvoiceForm;
  locked?: LockedFields;
  title: string;
  intro: string;
  onDone: (saved: boolean) => void;
}

export function ReviewForm({ base, initial, locked = {}, title, intro, onDone }: Props) {
  const { session } = useSession();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** null until the user picks: then the contract with the same CPE/CUI or sector is proposed. */
  const [contractChoice, setContractChoice] = useState<string | null>(null);

  const nif = form.issuerNif.trim();
  const known = useLiveQuery(async () => {
    if (!session || !isValidNif(nif)) return { provider: undefined, contracts: [] };
    const provider = (await session.repos.providers.findBy('nif', nif))[0];
    const contracts = provider
      ? await session.repos.contracts.findBy('providerId', provider.id)
      : [];
    return { provider, contracts };
  }, [session, nif]);

  if (!session) return null;
  const { repos } = session;
  const provider = known?.provider;
  const contracts = known?.contracts ?? [];
  const contractId =
    contractChoice ??
    defaultContractId(
      contracts,
      form.sector,
      base.parsed?.extraction.supplyPointId?.value,
      base.parsed?.extraction.insurance?.value.policyNumber,
    );
  const current = { ...form, contractId };

  const set =
    <K extends keyof InvoiceForm>(field: K) =>
    (event: { target: { value: string } }) =>
      setForm((previous) => ({ ...previous, [field]: event.target.value as InvoiceForm[K] }));

  function chooseContract(chosen: string) {
    setContractChoice(chosen);
    const contract = contracts.find((candidate) => candidate.id === chosen);
    if (contract) setForm((previous) => ({ ...previous, sector: contract.sector }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = buildDraft(current, base, { providerKnown: provider !== undefined });
    setFormError(undefined);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const draft = result.draft;
      if (!draft.docKey && draft.docId)
        draft.docKey = await docKeyFor(draft.issuerNif, draft.docId);
      const settings = await getSettings(repos);
      await saveInvoice(repos, draft, { keepOriginalFile: settings.keepOriginalFiles });
      await refreshAlerts(repos);
      onDone(true);
    } catch (error) {
      setFormError(
        error instanceof DuplicateInvoiceError ? copy.errors.duplicate : copy.errors.unexpected,
      );
      setSaving(false);
    }
  }

  const fields = copy.fields;
  const id = (name: string) =>
    `review-` + `${base.fileHash.slice(0, 8)}-${base.docKey?.slice(0, 8) ?? 'm'}-${name}`;
  const showProviderName = !provider;

  return (
    <form className="review" onSubmit={submit} noValidate>
      <h3>{title}</h3>
      <p className="muted">{intro}</p>
      {base.parsed && (
        <p
          className={
            base.parsed.check.validation === 'failed' ? 'review-check is-failed' : 'review-check'
          }
        >
          {base.parsed.check.validation === 'passed'
            ? copy.review.checkPassed
            : base.parsed.check.validation === 'failed'
              ? copy.review.checkFailed
              : copy.review.checkNone}{' '}
          {copy.review.readCounts(
            base.parsed.extraction.lines.length,
            base.parsed.extraction.readings.length,
          )}
        </p>
      )}

      <div className="review-grid">
        <Field
          id={id('nif')}
          label={fields.issuerNif}
          inputMode="numeric"
          value={form.issuerNif}
          readOnly={locked.issuerNif}
          onChange={set('issuerNif')}
          error={errors.issuerNif}
        />
        {showProviderName ? (
          <Field
            id={id('provider')}
            label={fields.providerName}
            hint={fields.providerNameHint}
            value={form.providerName}
            onChange={set('providerName')}
            error={errors.providerName}
          />
        ) : (
          <Field
            id={id('provider')}
            label={fields.providerName}
            value={provider?.name ?? ''}
            readOnly
          />
        )}

        {contracts.length > 0 && (
          <SelectField
            id={id('contract')}
            label={fields.contract}
            value={contractId}
            onChange={(event) => chooseContract(event.target.value)}
          >
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.label}
              </option>
            ))}
            <option value="">{fields.newContract}</option>
          </SelectField>
        )}

        {!contractId && (
          <>
            <Field
              id={id('label')}
              label={fields.contractLabel}
              hint={fields.contractLabelHint}
              value={form.contractLabel}
              onChange={set('contractLabel')}
              error={errors.contractLabel}
            />
            <SelectField
              id={id('sector')}
              label={fields.sector}
              value={form.sector}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, sector: event.target.value as Sector }))
              }
            >
              {SECTORS.map((sector) => (
                <option key={sector} value={sector}>
                  {t.sectors[sector]}
                </option>
              ))}
            </SelectField>
            <Field
              id={id('customer')}
              label={fields.customerNumber}
              value={form.customerNumber}
              onChange={set('customerNumber')}
            />
          </>
        )}

        <Field
          id={id('doc')}
          label={fields.docId}
          value={form.docId}
          readOnly={locked.docId}
          onChange={set('docId')}
        />
        <Field
          id={id('date')}
          label={fields.issueDate}
          type="date"
          value={form.issueDate}
          readOnly={locked.issueDate}
          onChange={set('issueDate')}
          error={errors.issueDate}
        />
        <Field
          id={id('total')}
          label={fields.total}
          inputMode="decimal"
          value={form.total}
          readOnly={locked.total}
          onChange={set('total')}
          error={errors.total}
        />
        <Field
          id={id('vat')}
          label={fields.vat}
          inputMode="decimal"
          value={form.vat}
          readOnly={locked.vat}
          onChange={set('vat')}
          error={errors.vat}
        />
        <Field
          id={id('start')}
          label={fields.periodStart}
          type="date"
          value={form.periodStart}
          onChange={set('periodStart')}
          error={errors.periodStart}
        />
        <Field
          id={id('end')}
          label={fields.periodEnd}
          type="date"
          value={form.periodEnd}
          onChange={set('periodEnd')}
          error={errors.periodEnd}
        />
        <Field
          id={id('due')}
          label={fields.dueDate}
          type="date"
          value={form.dueDate}
          onChange={set('dueDate')}
          error={errors.dueDate}
        />
      </div>

      {formError && (
        <p className="ingest-problem" role="alert">
          {formError}
        </p>
      )}
      <div className="ingest-actions">
        <button type="submit" className="action-primary" disabled={saving}>
          {saving ? copy.review.saving : copy.review.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => onDone(false)}>
          {copy.review.skip}
        </button>
      </div>
    </form>
  );
}
