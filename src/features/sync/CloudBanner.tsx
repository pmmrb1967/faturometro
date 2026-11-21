import { Link, useLocation } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { SYNC_ANCHOR } from './anchor';
import { useSyncStatus } from './sync-store';

const copy = t.sync.cloud.banner;

/** The OneDrive link expired, or another device moved the account to OneDrive. */
export function CloudBanner() {
  const { pathname } = useLocation();
  const { error } = useSyncStatus();
  const text =
    error === 'needs_reconnect' ? copy.reconnect : error === 'moved_to_cloud' ? copy.moved : null;
  if (!text || pathname === '/app/definicoes') return null;
  return (
    <div className="update-banner backup-banner" role="status">
      <span>{text}</span>
      <Link to={`/app/definicoes#${SYNC_ANCHOR}`} className="action-secondary action-compact">
        {copy.action}
      </Link>
    </div>
  );
}
