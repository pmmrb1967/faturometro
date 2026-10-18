import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link } from 'react-router';
import comEscolhaData from '../../data/comescolha.json';
import { checkIsStale, comEscolhaConfigSchema } from '../../domain/comescolha';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { useSession } from '../auth/session-context';
import { HouseholdSection } from '../household/HouseholdSection';
import { dismissAlert, refreshAlerts, today } from './refresh';
import './alerts.css';

/** Administrator only: the weekly COM.escolha check (maintainer's PC) has not passed lately. */
function staleComEscolhaCheck(): string | null {
  const config = comEscolhaConfigSchema.safeParse(comEscolhaData);
  if (!config.success) return formatIsoDate(today());
  return checkIsStale(config.data.checkedAt, today()) ? formatIsoDate(config.data.checkedAt) : null;
}

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
  const staleCheck = session.profile.sync?.admin ? staleComEscolhaCheck() : null;
  const waiting = session.profile.sync?.admin ? (session.profile.sync.contributions ?? 0) : 0;

  return (
    <>
      <h1>{t.nav.home}</h1>
      <h2 className="section-title">{t.alerts.title}</h2>
      {alerts?.length === 0 && !staleCheck && waiting === 0 && (
        <p className="muted">{t.alerts.empty}</p>
      )}
      <ul className="alerts">
        {waiting > 0 && (
          <li className="alert alert-info">
            <span className="alert-icon" aria-hidden="true">
              i
            </span>
            <span className="alert-message">{t.alerts.admin.contributions(waiting)}</span>
          </li>
        )}
        {staleCheck && (
          <li className="alert alert-warning">
            <span className="alert-icon" aria-hidden="true">
              !
            </span>
            <span className="alert-message">{t.alerts.admin.comEscolhaStale(staleCheck)}</span>
          </li>
        )}
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
      <p className="home-link">
        <Link to="/app/tarifa-social">{t.socialTariff.homeLink}</Link>
      </p>
      <HouseholdSection />
    </>
  );
}
