import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import {
  buildProfile,
  PROFILE_MIN_DAYS,
  profileSummary,
  sameSupplyPoint,
} from '../../domain/consumption-profile';
import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { parseEredesXlsx, type EredesError } from './eredes';
import './eredes.css';

const copy = t.contracts.eredes;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });

function errorText(error: EredesError, row = 0): string {
  const text = copy.errors[error];
  return typeof text === 'function' ? text(row) : text;
}

/**
 * Electricity contract → the 15-minute export of the E-Redes Balcão Digital:
 * how to get it, import (read on the device, kept as daily sums) and removal.
 */
export function EredesSection({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const profile = useLiveQuery(async () => {
    if (!session || !contract.supplyPointId) return null;
    const profiles = await session.repos.consumptionProfiles.list();
    return profiles.find((item) => sameSupplyPoint(item.supplyPointId, contract.supplyPointId));
  }, [session, contract.supplyPointId]);
  if (!session) return null;
  const { repos } = session;

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage({ text: copy.reading, problem: false });
    try {
      const result = parseEredesXlsx(new Uint8Array(await file.arrayBuffer()));
      if (!result.ok) {
        setMessage({ text: errorText(result.error, result.row), problem: true });
        return;
      }
      if (
        contract.supplyPointId &&
        !sameSupplyPoint(result.supplyPointId, contract.supplyPointId)
      ) {
        setMessage({ text: copy.errors.otherSupplyPoint(result.supplyPointId), problem: true });
        return;
      }
      const existing = (await repos.consumptionProfiles.list()).find((item) =>
        sameSupplyPoint(item.supplyPointId, result.supplyPointId),
      );
      await repos.consumptionProfiles.put({
        id: existing?.id ?? crypto.randomUUID(),
        ...buildProfile(result.supplyPointId, result.quarters, result.missing),
        importedAt: new Date().toISOString(),
      });
      if (!contract.supplyPointId) {
        await repos.contracts.put({ ...contract, supplyPointId: result.supplyPointId });
      }
      setMessage({ text: copy.imported, problem: false });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!profile || !window.confirm(copy.removeConfirm)) return;
    await repos.consumptionProfiles.remove(profile.id);
    setMessage({ text: copy.removed, problem: false });
  }

  const summary = profile ? profileSummary(profile, today()) : null;
  return (
    <section className="eredes-card" aria-labelledby="eredes-title">
      <h2 id="eredes-title" className="section-title">
        {copy.title}
      </h2>
      {profile && summary ? (
        <>
          <p>
            <strong>
              {copy.stored(formatIsoDate(profile.dateFrom), formatIsoDate(profile.dateTo))}
            </strong>
          </p>
          <p>{copy.storedDetail(kwh.format(summary.kwh), summary.days)}</p>
          <p>
            {copy.emptyShare(
              percent.format(summary.emptyShare['pre-2027'] * 100),
              percent.format(summary.emptyShare['2027'] * 100),
            )}
          </p>
          {summary.estimatedShare > 0 && (
            <p className="muted">{copy.estimated(percent.format(summary.estimatedShare * 100))}</p>
          )}
          {summary.daysInLastYear >= PROFILE_MIN_DAYS ? (
            <p className="muted">{copy.used}</p>
          ) : (
            <p className="ingest-problem">{copy.stale(summary.daysInLastYear)}</p>
          )}
        </>
      ) : (
        <>
          <p>{copy.intro}</p>
          <h3>{copy.stepsTitle}</h3>
          <ol className="eredes-steps">
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
      <p className="muted">{profile ? copy.replaceHint : copy.privacy}</p>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => void importFile(event)}
      />
      <div className="ingest-actions">
        <button
          type="button"
          className={profile ? 'action-secondary' : 'action-primary'}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {profile ? copy.chooseAgain : copy.choose}
        </button>
        {profile && (
          <button
            type="button"
            className="action-secondary"
            disabled={busy}
            onClick={() => void remove()}
          >
            {copy.remove}
          </button>
        )}
      </div>
      {message && (
        <p className={message.problem ? 'ingest-problem' : 'doc-saved'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
