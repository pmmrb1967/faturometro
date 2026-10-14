import { useState } from 'react';
import { Field } from '../../components/Field';
import comEscolhaData from '../../data/comescolha.json';
import { comEscolhaConfigSchema, comEscolhaUrl, monthlyAverage } from '../../domain/comescolha';
import {
  TELECOM_SERVICES,
  type Contract,
  type Invoice,
  type TelecomService,
} from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents, wholeEurosUp } from '../../lib/money';
import './telecom.css';

const copy = t.contracts.telecom;
/** Checked weekly by scripts/comescolha-check.ts; validated like any outside data. */
const config = comEscolhaConfigSchema.safeParse(comEscolhaData);

/** Telecom contract: its services and a prefilled search on ANACOM's COM.escolha. */
export function TelecomCompare({
  contract,
  invoices,
  onSaveServices,
}: {
  contract: Contract;
  invoices: readonly Invoice[];
  onSaveServices: (services: TelecomService[]) => Promise<void>;
}) {
  const stored = contract.telecom;
  const [services, setServices] = useState<TelecomService[]>(stored?.services ?? []);
  const [saved, setSaved] = useState(false);
  const [postal, setPostal] = useState('');
  const [cheaperOnly, setCheaperOnly] = useState(true);
  const average = monthlyAverage(invoices);
  const changed = services.join() !== (stored?.services ?? []).join();
  const unconfirmed = stored?.fromInvoice === true;

  function toggle(service: TelecomService, on: boolean) {
    setServices((current) =>
      TELECOM_SERVICES.filter((item) => (item === service ? on : current.includes(item))),
    );
    setSaved(false);
  }

  const url = config.success
    ? comEscolhaUrl(config.data, {
        services,
        ...(cheaperOnly && average ? { monthlyLimitCents: average.cents } : {}),
        postalPrefix: postal,
      })
    : null;
  const postalInvalid = postal !== '' && !/^\d{4}$/.test(postal);

  return (
    <section className="telecom-compare" aria-labelledby="telecom-compare-title">
      <h2 id="telecom-compare-title" className="section-title">
        {copy.title}
      </h2>

      <fieldset className="telecom-services">
        <legend>{copy.services}</legend>
        {TELECOM_SERVICES.map((service) => (
          <label key={service} className="telecom-check">
            <input
              type="checkbox"
              checked={services.includes(service)}
              onChange={(event) => toggle(service, event.target.checked)}
            />
            {copy.serviceNames[service]}
          </label>
        ))}
      </fieldset>
      {unconfirmed && !changed && <p className="field-hint">{copy.fromInvoice}</p>}
      {(changed || unconfirmed) && services.length > 0 && (
        <button
          type="button"
          className="action-secondary"
          onClick={() => void onSaveServices(services).then(() => setSaved(true))}
        >
          {unconfirmed && !changed ? copy.confirm : copy.save}
        </button>
      )}
      {saved && (
        <p role="status" className="doc-saved">
          {copy.saved}
        </p>
      )}

      {average && (
        <>
          <p>{copy.average(formatCents(average.cents), average.count)}</p>
          <label className="telecom-check">
            <input
              type="checkbox"
              checked={cheaperOnly}
              onChange={(event) => setCheaperOnly(event.target.checked)}
            />
            {copy.cheaperOnly(wholeEurosUp(average.cents))}
          </label>
        </>
      )}
      <Field
        id="telecom-postal"
        label={copy.postal}
        hint={copy.postalHint}
        error={postalInvalid ? copy.postalInvalid : undefined}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={postal}
        onChange={(event) => setPostal(event.target.value.trim())}
      />

      {services.length === 0 ? (
        <p className="muted">{copy.chooseServices}</p>
      ) : url ? (
        <a className="action-primary" href={url} target="_blank" rel="noopener noreferrer">
          {copy.open}
        </a>
      ) : (
        <p className="muted">{copy.unavailable}</p>
      )}
      <p className="muted telecom-note">{copy.note}</p>
    </section>
  );
}
