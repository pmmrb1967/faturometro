import { useLiveQuery } from 'dexie-react-hooks';
import { backupStatus, type BackupStatus } from '../../domain/backup-reminder';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';

/** The state of the backup; with sync there is none to show, the server holds a copy. */
export function useBackupStatus(): BackupStatus | null | undefined {
  const { session } = useSession();
  return useLiveQuery(async () => {
    if (!session || session.profile.sync) return null;
    const { repos } = session;
    const [settings, ...records] = await Promise.all([
      getSettings(repos),
      repos.contracts.list(),
      repos.transactions.list(),
      repos.expenses.list(),
      repos.incomes.list(),
    ]);
    return backupStatus({
      hasData: records.some((list) => list.length > 0),
      lastBackupAt: settings.lastBackupAt,
      today: today(),
    });
  }, [session]);
}
