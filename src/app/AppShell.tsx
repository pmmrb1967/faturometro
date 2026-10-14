import { Link, NavLink, Outlet } from 'react-router';
import { LegalFooter } from '../components/LegalFooter';
import { useSession } from '../features/auth/session-context';
import { useAutoSync } from '../features/sync/sync-store';
import { t } from '../i18n/pt-PT';
import { applyUpdate, useUpdateAvailable } from './pwa';
import { SECTIONS, type SectionId } from './sections';

export function AppShell() {
  const { session, lock, updateProfile } = useSession();
  useAutoSync(session, updateProfile);
  const updateAvailable = useUpdateAvailable();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          {t.appName}
        </Link>
        <div className="topbar-account">
          {session?.profile.sync?.admin && <span className="topbar-badge">{t.adminBadge}</span>}
          <span className="topbar-email">{session?.profile.email}</span>
          <button
            type="button"
            className="topbar-lock"
            onClick={lock}
            aria-label={t.signOutLabel}
            title={t.signOutLabel}
          >
            {t.signOut}
          </button>
        </div>
      </header>

      <nav className="nav" aria-label={t.appName}>
        {SECTIONS.map((section) => (
          <NavLink key={section.id} to={section.path} end className="nav-item">
            {t.nav[section.id]}
          </NavLink>
        ))}
      </nav>

      <main className="content">
        {updateAvailable && (
          <div className="update-banner" role="status">
            <span>
              {t.update.available} {t.update.hint}
            </span>
            <button type="button" className="topbar-lock" onClick={applyUpdate}>
              {t.update.apply}
            </button>
          </div>
        )}
        <Outlet />
        <LegalFooter />
      </main>
    </div>
  );
}

export function SectionPlaceholder({ section }: { section: SectionId }) {
  return (
    <>
      <h1>{t.nav[section]}</h1>
      {section === 'home' && <p className="lead">{t.tagline}</p>}
      <p className="muted">{t.placeholder}</p>
    </>
  );
}

export function NotFound() {
  return (
    <main className="content">
      <h1>{t.notFound.title}</h1>
      <p className="muted">{t.notFound.body}</p>
      <Link to="/">{t.notFound.back}</Link>
    </main>
  );
}
