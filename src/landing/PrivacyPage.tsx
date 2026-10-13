import { Link } from 'react-router';
import { LegalFooter } from '../components/LegalFooter';
import { t } from '../i18n/pt-PT';
import './landing.css';

const copy = t.privacyPage;

/** Public privacy page (PLAN.md §11): what exists, where it lives, who can read it. */
export function PrivacyPage() {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Link to="/" className="landing-brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          {t.appName}
        </Link>
      </header>
      <main className="legal-page">
        <h1>{copy.title}</h1>
        <p className="legal-updated">{copy.updated}</p>
        <p className="hero-lead">{copy.intro}</p>
        {copy.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <p>
          <Link to="/">{copy.back}</Link>
        </p>
      </main>
      <div className="landing-footer-wrap">
        <LegalFooter className="landing-footer" />
      </div>
    </div>
  );
}
