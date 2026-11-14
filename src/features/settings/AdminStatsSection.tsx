import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { t } from '../../i18n/pt-PT';
import { adminStats } from '../../sync/account';
import { useSession } from '../auth/session-context';
import { formatMegabytes } from './format';

const copy = t.adminStats;

/** "2,5", or "< 0,1" for a little above zero. */
function percentOf(used: number, total: number): string {
  const percent = (used / total) * 100;
  return used > 0 && percent < 0.1
    ? '< 0,1'
    : percent.toLocaleString('pt-PT', { maximumFractionDigits: 1 });
}

/** "12,3 MB de 500 MB (2,5 %)"; without a known capacity, just the size. */
function usage(used: number, total: number | undefined): string {
  if (!total) return formatMegabytes(used);
  return copy.ofTotal(formatMegabytes(used), formatMegabytes(total), percentOf(used, total));
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
        ...(stats.freeAi
          ? [
              [
                copy.freeAi,
                stats.freeAi.enabled
                  ? copy.freeAiValue(
                      stats.freeAi.neurons.toLocaleString('pt-PT'),
                      stats.freeAi.neuronsCap.toLocaleString('pt-PT'),
                      percentOf(stats.freeAi.neurons, stats.freeAi.neuronsCap),
                      stats.freeAi.calls,
                      stats.freeAi.devices,
                    )
                  : copy.freeAiOff,
              ] satisfies [string, ReactNode],
            ]
          : []),
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
      {stats?.freeAi && (
        <p className="muted">{copy.freeAiNote(stats.freeAi.neuronsFree.toLocaleString('pt-PT'))}</p>
      )}
    </section>
  );
}
