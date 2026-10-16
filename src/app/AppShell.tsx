import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { LegalFooter } from '../components/LegalFooter';
import { isGuest } from '../db/profiles';
import { useSession } from '../features/auth/session-context';
import { useAutoSync } from '../features/sync/sync-store';
import { t } from '../i18n/pt-PT';
import { NavIcon } from './NavIcon';
import { applyUpdate, useUpdateAvailable } from './pwa';
import { SECTIONS, type SectionId } from './sections';

export function AppShell() {
  const { session, lock, updateProfile } = useSession();
  const navigate = useNavigate();
  useAutoSync(session, updateProfile);
  const updateAvailable = useUpdateAvailable();
  // The long title is for search results (index.html); inside the app the tab shows the name.
  useEffect(() => {
    document.title = 'Faturómetro';
  }, []);

  // A guest alone on the device reopens by itself from /app: go to the login page instead.
  function leaveGuest() {
    navigate('/entrar', { replace: true });
    lock();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          {t.appName}
        </Link>
        <div className="topbar-account">
          {session && isGuest(session.profile) ? (
            <>
              <span className="topbar-badge">{t.guest.badge}</span>
              <Link to="/criar-conta" className="topbar-lock">
                {t.guest.createAccount}
              </Link>
              <button
                type="button"
                className="topbar-lock"
                onClick={leaveGuest}
                aria-label={t.guest.signOutLabel}
                title={t.guest.signOutLabel}
              >
                {t.signOut}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>

      <nav className="nav" aria-label={t.appName}>
        {SECTIONS.map((section) => (
          <NavLink key={section.id} to={section.path} end className="nav-item">
            <NavIcon section={section.id} />
            <span>{t.nav[section.id]}</span>
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
