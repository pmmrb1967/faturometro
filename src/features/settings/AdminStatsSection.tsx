import { useLiveQuery } from 'dexie-react-hooks';
import { t } from '../../i18n/pt-PT';
import { adminStats } from '../../sync/account';
import { useSession } from '../auth/session-context';
import { formatMegabytes } from './format';
import '../alerts/alerts.css';

const copy = t.adminStats;

/** Administrator only: how the sync server is being used (totals, no accounts named). */
export function AdminStatsSection() {
  const { session } = useSession();
  const admin = Boolean(session?.profile.sync?.admin);
  const stats = useLiveQuery(async () => {
    if (!session || !admin) return null;
    try {
      return await adminStats(session);
    } catch {
      return undefined;
    }
  }, [session, admin]);
  if (!admin) return null;

  return (
    <section className="settings-section" aria-labelledby="admin-stats-title">
      <h2 id="admin-stats-title">{copy.title}</h2>
      <p className="muted">{copy.intro}</p>
      {stats === undefined && <p className="ingest-problem">{copy.failed}</p>}
      {stats && (
        <dl className="facts">
          <dt>{copy.accounts}</dt>
          <dd>{copy.ofMax(stats.accounts, stats.maxAccounts)}</dd>
          <dt>{copy.newAccounts}</dt>
          <dd>{copy.period(stats.newAccounts.days7, stats.newAccounts.days30)}</dd>
          <dt>{copy.active}</dt>
          <dd>{copy.activeValue(stats.active.today, stats.active.days7, stats.active.days30)}</dd>
          <dt>{copy.devices}</dt>
          <dd>{stats.devices}</dd>
          <dt>{copy.removed}</dt>
          <dd>{stats.removedForInactivity30}</dd>
          <dt>{copy.space}</dt>
          <dd>
            {copy.spaceValue(
              formatMegabytes(stats.recordsBytes),
              formatMegabytes(stats.filesBytes),
            )}
          </dd>
          <dt>{copy.contributions}</dt>
          <dd>{stats.contributions}</dd>
        </dl>
      )}
    </section>
  );
}
