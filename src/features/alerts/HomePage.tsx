import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { dismissAlert, refreshAlerts } from './refresh';
import './alerts.css';

export function HomePage() {
  const { session } = useSession();

  useEffect(() => {
    // Date-based alerts (loyalty, missing invoice) change with the calendar.
    if (session) void refreshAlerts(session.repos);
  }, [session]);

  const alerts = useLiveQuery(async () => {
    if (!session) return [];
    const all = await session.repos.alerts.list();
    return all
      .filter((alert) => !alert.dismissedAt)
      .sort((a, b) =>
        a.severity === b.severity
          ? b.createdAt.localeCompare(a.createdAt)
          : a.severity === 'warning'
            ? -1
            : 1,
      );
  }, [session]);

  if (!session) return null;

  return (
    <>
      <h1>{t.nav.home}</h1>
      <h2 className="section-title">{t.alerts.title}</h2>
      {alerts?.length === 0 && <p className="muted">{t.alerts.empty}</p>}
      <ul className="alerts">
        {alerts?.map((alert) => (
          <li key={alert.id} className={`alert alert-${alert.severity}`}>
            <span className="alert-icon" aria-hidden="true">
              {alert.severity === 'warning' ? '!' : 'i'}
            </span>
            <Link to={`/app/contratos/${alert.contractId}`} className="alert-message">
              {alert.message}
            </Link>
            <button
              type="button"
              className="alert-dismiss"
              onClick={() => void dismissAlert(session.repos, alert.id)}
            >
              {t.alerts.dismiss}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
