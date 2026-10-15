import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { t } from '../../i18n/pt-PT';
import { adminStats } from '../../sync/account';
import { useSession } from '../auth/session-context';
import { formatMegabytes } from './format';

const copy = t.adminStats;

/** "12,3 MB de 500 MB (2,5 %)"; without a known capacity, just the size. */
function usage(used: number, total: number | undefined): string {
  if (!total) return formatMegabytes(used);
  const percent = (used / total) * 100;
  const shown =
    used > 0 && percent < 0.1
      ? '< 0,1'
      : percent.toLocaleString('pt-PT', { maximumFractionDigits: 1 });
  return copy.ofTotal(formatMegabytes(used), formatMegabytes(total), shown);
}

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

  const rows: [string, ReactNode][] = stats
    ? [
        [copy.accounts, copy.ofMax(stats.accounts, stats.maxAccounts)],
        [copy.newAccounts, copy.period(stats.newAccounts.days7, stats.newAccounts.days30)],
        [
          copy.active,
          copy.activeValue(stats.active.today, stats.active.days7, stats.active.days30),
        ],
        [copy.devices, stats.devices],
        [copy.removed, copy.removedValue(stats.removedForInactivity30)],
        [copy.records, usage(stats.recordsBytes, stats.recordsTotalBytes)],
        [copy.files, usage(stats.filesBytes, stats.filesTotalBytes)],
        [copy.contributions, stats.contributions],
      ]
    : [];

  return (
    <section className="settings-section" aria-labelledby="admin-stats-title">
      <h2 id="admin-stats-title">{copy.title}</h2>
      <p className="muted">{copy.intro}</p>
      {stats === undefined && <p className="ingest-problem">{copy.failed}</p>}
      {stats && (
        <table className="admin-stats">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stats && <p className="muted">{copy.spaceNote}</p>}
    </section>
  );
}
