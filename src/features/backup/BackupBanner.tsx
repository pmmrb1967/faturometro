import { Link, useLocation } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { BACKUP_ANCHOR } from './backup';
import { useBackupStatus } from './use-backup-status';

/** Início says it in full, and the settings page is where the backup is made. */
const PAGES_WITHOUT_BANNER = new Set(['/app', '/app/definicoes']);

/** A backup is missing: shown on the other pages until it is made. */
export function BackupBanner() {
  const { pathname } = useLocation();
  const status = useBackupStatus();
  const due = status?.kind === 'never' || status?.kind === 'overdue';
  if (!due || PAGES_WITHOUT_BANNER.has(pathname)) return null;
  return (
    <div className="update-banner backup-banner" role="status">
      <span>{t.alerts.backup.banner}</span>
      <Link to={`/app/definicoes#${BACKUP_ANCHOR}`} className="action-secondary action-compact">
        {t.alerts.backup.bannerAction}
      </Link>
    </div>
  );
}
