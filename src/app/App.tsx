import { useState } from 'react';
import { t } from '../i18n/pt-PT';

const SECTIONS = ['home', 'contracts', 'invoices', 'compare', 'settings'] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  const [section, setSection] = useState<Section>('home');

  return (
    <div className="shell">
      <header className="topbar">
        <img src="/icon.svg" alt="" width={28} height={28} />
        <span className="brand">{t.appName}</span>
      </header>

      <nav className="nav" aria-label={t.appName}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className="nav-item"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            {t.nav[id]}
          </button>
        ))}
      </nav>

      <main className="content">
        <h1>{t.nav[section]}</h1>
        {section === 'home' && <p className="lead">{t.tagline}</p>}
        <p className="muted">{t.placeholder}</p>
      </main>
    </div>
  );
}
