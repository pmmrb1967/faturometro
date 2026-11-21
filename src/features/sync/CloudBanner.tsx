import { Link, useLocation } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { SYNC_ANCHOR } from './anchor';
import { serviceOf } from './cloud-service';
import { useSyncStatus } from './sync-store';

const copy = t.sync.cloud.banner;

/** The cloud link expired, or another device moved the account to a cloud. */
export function CloudBanner() {
  const { pathname } = useLocation();
  const { error } = useSyncStatus();
  const { session } = useSession();
  const provider = session?.profile.cloud?.provider;
  const text =
    error === 'needs_reconnect' && provider
      ? copy.reconnect(serviceOf(provider))
      : error === 'needs_reconnect'
        ? t.sync.errors.needs_reconnect
        : error === 'moved_to_cloud'
          ? copy.moved
          : null;
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
