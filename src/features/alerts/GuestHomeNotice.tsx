import { Link } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { BACKUP_ANCHOR } from '../backup/backup';

/** What using the app without an account costs; gone as soon as an account is created. */
export function GuestHomeNotice() {
  const copy = t.guest.home;
  return (
    <section className="alert alert-warning guest-notice" aria-labelledby="guest-home-title">
      <span className="alert-icon" aria-hidden="true">
        !
      </span>
      <div>
        <h2 id="guest-home-title">{t.guest.noticeTitle}</h2>
        <p className="guest-notice-summary">{copy.summary}</p>
        {/* The whole list filled a phone's first screen on every visit: one tap away now. */}
        <details className="guest-notice-more">
          <summary>{copy.more}</summary>
          <ul>
            {copy.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </details>
        <div className="guest-notice-actions">
          <Link to="/criar-conta" className="action-primary">
            {t.guest.createAccount}
          </Link>
          <Link to={`/app/definicoes#${BACKUP_ANCHOR}`} className="action-secondary">
            {copy.backup}
          </Link>
        </div>
      </div>
    </section>
  );
}
