import { Link, NavLink, Outlet } from 'react-router';
import { t } from '../i18n/pt-PT';
import { SECTIONS, type SectionId } from './sections';

export function AppShell() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          {t.appName}
        </Link>
      </header>

      <nav className="nav" aria-label={t.appName}>
        {SECTIONS.map((section) => (
          <NavLink key={section.id} to={section.path} end className="nav-item">
            {t.nav[section.id]}
          </NavLink>
        ))}
      </nav>

      <main className="content">
        <Outlet />
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
