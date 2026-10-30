import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { LegalFooter } from '../components/LegalFooter';
import { isGuest } from '../db/profiles';
import { useSession } from '../features/auth/session-context';
import { useAutoSync } from '../features/sync/sync-store';
import { t } from '../i18n/pt-PT';
import { NavIcon } from './NavIcon';
import { applyUpdate, useUpdateAvailable } from './pwa';
import { SECTIONS, type SectionId } from './sections';

/** Per-device choice: side menu reduced to its icons (wide screens only). */
const NAV_COLLAPSED_KEY = 'faturometro.nav.collapsed';

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { session, lock, updateProfile } = useSession();
  const navigate = useNavigate();
  useAutoSync(session, updateProfile);
  const updateAvailable = useUpdateAvailable();
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  // The long title is for search results (index.html); inside the app the tab shows the name.
  useEffect(() => {
    document.title = 'Faturómetro';
  }, []);

  // Always the landing page, which offers the right next step. Leaving first: without a
  // session, a page of the app would send to sign in, and a lone guest would reopen by itself.
  function signOut() {
    navigate('/', { replace: true });
    lock();
  }

  function toggleNav() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Not remembered on this device; the choice still applies now.
    }
  }

  return (
    <div className={collapsed ? 'shell is-nav-collapsed' : 'shell'}>
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
                onClick={signOut}
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
                onClick={signOut}
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
        <button
          type="button"
          className="nav-toggle"
          onClick={toggleNav}
          {...(collapsed ? { title: t.navToggle.expand } : {})}
        >
          <svg
            className="nav-icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <span>{collapsed ? t.navToggle.expand : t.navToggle.collapse}</span>
        </button>
        {SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end
            className="nav-item"
            {...(collapsed ? { title: t.nav[section.id] } : {})}
          >
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
