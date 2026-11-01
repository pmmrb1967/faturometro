import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link } from 'react-router';
import comEscolhaData from '../../data/comescolha.json';
import { checkIsStale, comEscolhaConfigSchema } from '../../domain/comescolha';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { isGuest } from '../../db/profiles';
import { useSession } from '../auth/session-context';
import { BACKUP_ANCHOR } from '../backup/backup';
import { useBackupStatus } from '../backup/use-backup-status';
import { HouseholdSection } from '../household/HouseholdSection';
import { GuestHomeNotice } from './GuestHomeNotice';
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

  const backup = useBackupStatus();

  if (!session) return null;
  const backupDue = backup?.kind === 'never' || backup?.kind === 'overdue';
  const staleCheck = session.profile.sync?.admin ? staleComEscolhaCheck() : null;
  const waiting = session.profile.sync?.admin ? (session.profile.sync.contributions ?? 0) : 0;

  return (
    <>
      <h1>{t.nav.home}</h1>
      {isGuest(session.profile) && <GuestHomeNotice />}
      <h2 className="section-title">{t.alerts.title}</h2>
      {alerts?.length === 0 && !staleCheck && waiting === 0 && !backupDue && (
        <p className="muted">{t.alerts.empty}</p>
      )}
      <ul className="alerts">
        {backupDue && (
          <li className="alert alert-warning">
            <span className="alert-icon" aria-hidden="true">
              !
            </span>
            <Link to={`/app/definicoes#${BACKUP_ANCHOR}`} className="alert-message">
              {backup.kind === 'never'
                ? t.alerts.backup.never
                : t.alerts.backup.overdue(formatIsoDate(backup.lastBackupAt))}
            </Link>
          </li>
        )}
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
            <Link
              to={
                // Paid marks are set on "Este mês"; the offer is in Comparar, electricity tab.
                alert.kind === 'payment_due'
                  ? '/app/mes?separador=pagamentos'
                  : alert.kind === 'cheaper_offer'
                    ? '/app/comparar?separador=luz'
                    : `/app/contratos/${alert.contractId}`
              }
              className="alert-message"
            >
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
      {backup?.kind === 'recent' && (
        <p className="muted">{t.alerts.backup.recent(formatIsoDate(backup.lastBackupAt))}</p>
      )}
      <p className="home-link">
        <Link to="/app/tarifa-social">{t.socialTariff.homeLink}</Link>
      </p>
      <HouseholdSection />
    </>
  );
}
