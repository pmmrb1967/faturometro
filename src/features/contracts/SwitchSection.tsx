import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Field, SelectField } from '../../components/Field';
import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { refreshAlerts, today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { replacedContract } from './switch-view';
import './switch.css';

const copy = t.contracts.switch;
const NOT_YET = '';

/**
 * "Mudei de fornecedor": ends this contract and links the one that replaced it;
 * on the new contract, the estimated savings since the change.
 */
export function SwitchSection({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const contracts = await session.repos.contracts.list();
    const providers = new Map(
      (await session.repos.providers.list()).map((provider) => [provider.id, provider.name]),
    );
    const name = (other: Contract) =>
      [other.label, providers.get(other.providerId)].filter(Boolean).join(', ');
    return {
      candidates: contracts
        .filter((other) => other.id !== contract.id && other.sector === contract.sector)
        .map((other) => ({ id: other.id, name: name(other) })),
      replacement: contract.replacedById
        ? contracts.find((other) => other.id === contract.replacedById)
        : undefined,
      replaced: await replacedContract(session.repos, contract),
      name,
    };
  }, [session, contract]);
  if (!session || !data) return null;
  const { repos } = session;

  async function end(date: string, replacedById: string) {
    const next: Contract = { ...contract, active: false, endedAt: date };
    if (replacedById) next.replacedById = replacedById;
    else delete next.replacedById;
    await repos.contracts.put(next);
    await refreshAlerts(repos);
    setOpen(false);
  }

  async function reactivate() {
    const next: Contract = { ...contract, active: true };
    delete next.endedAt;
    delete next.replacedById;
    await repos.contracts.put(next);
    await refreshAlerts(repos);
  }

  const { replaced } = data;
  const savings = replaced?.savings;
  return (
    <>
      {replaced && replaced.previous.endedAt && (
        <section className="switch-card" aria-labelledby="switch-savings-title">
          <h2 id="switch-savings-title" className="section-title">
            {copy.title}
          </h2>
          <p>
            {copy.replaces}{' '}
            <Link to={`/app/contratos/${replaced.previous.id}`}>
              {data.name(replaced.previous)}
            </Link>{' '}
            {copy.since(formatIsoDate(replaced.previous.endedAt))}
          </p>
          {savings ? (
            <>
              <p className="switch-result">
                <strong>
                  {savings.savingCents >= 0
                    ? copy.saving(formatCents(savings.savingCents), savings.invoices)
                    : copy.costMore(formatCents(-savings.savingCents), savings.invoices)}
                </strong>
              </p>
              <p className="muted">
                {copy.methods[savings.method]} {copy.note}
              </p>
            </>
          ) : (
            <p className="muted">{copy.noData}</p>
          )}
        </section>
      )}

      {!contract.active && contract.endedAt ? (
        <section className="switch-card" aria-labelledby="switch-ended-title">
          <h2 id="switch-ended-title" className="section-title">
            {copy.title}
          </h2>
          <p>{copy.ended(formatIsoDate(contract.endedAt))}</p>
          {data.replacement ? (
            <p>
              {copy.replacedBy}{' '}
              <Link to={`/app/contratos/${data.replacement.id}`}>
                {data.name(data.replacement)}
              </Link>
            </p>
          ) : (
            <p className="muted">{copy.waiting}</p>
          )}
          <div className="ingest-actions">
            <button type="button" className="action-secondary" onClick={() => void reactivate()}>
              {copy.reactivate}
            </button>
          </div>
        </section>
      ) : open ? (
        <SwitchForm
          candidates={data.candidates}
          onSave={(date, replacedById) => end(date, replacedById)}
          onCancel={() => setOpen(false)}
        />
      ) : (
        contract.active && (
          <div className="ingest-actions switch-start">
            <button type="button" className="action-secondary" onClick={() => setOpen(true)}>
              {copy.start}
            </button>
          </div>
        )
      )}
    </>
  );
}

function SwitchForm({
  candidates,
  onSave,
  onCancel,
}: {
  candidates: { id: string; name: string }[];
  onSave: (date: string, replacedById: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(today());
  const [replacedById, setReplacedById] = useState(NOT_YET);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!date) {
      setError(t.invoices.errors.date);
      return;
    }
    await onSave(date, replacedById);
  }

  return (
    <form className="switch-card" onSubmit={submit} noValidate>
      <h2 className="section-title">{copy.start}</h2>
      <p className="muted">{copy.intro}</p>
      <Field
        id="switch-date"
        label={copy.date}
        type="date"
        value={date}
        {...(error ? { error } : {})}
        onChange={(event) => {
          setDate(event.target.value);
          setError(undefined);
        }}
      />
      <SelectField
        id="switch-new"
        label={copy.newContract}
        {...(replacedById === NOT_YET ? { hint: copy.notYetHint } : {})}
        value={replacedById}
        onChange={(event) => setReplacedById(event.target.value)}
      >
        <option value={NOT_YET}>{copy.notYet}</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </SelectField>
      <div className="ingest-actions">
        <button type="submit" className="action-primary">
          {copy.save}
        </button>
        <button type="button" className="action-secondary" onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}
