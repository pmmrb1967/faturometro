import { Link } from 'react-router';
import { t } from '../i18n/pt-PT';
import { QrSlip } from './QrSlip';
import './landing.css';

const REPO_URL = 'https://github.com/pmmrb1967/faturometro';
const copy = t.landing;

export function Landing() {
  return (
    <div className="landing">
      <p className="landing-status" role="status">
        {copy.status}
      </p>

      <header className="landing-bar">
        <Link to="/" className="landing-brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          {t.appName}
        </Link>
        <Link to="/entrar" className="button button-quiet">
          {copy.signIn}
        </Link>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>{copy.hero.title}</h1>
            <p className="hero-lead">{copy.hero.lead}</p>
            <div className="hero-actions">
              <Link to="/criar-conta" className="button button-primary">
                {copy.createAccount}
              </Link>
              <a href="#como-funciona" className="button button-quiet">
                {copy.howItWorksLink}
              </a>
            </div>
          </div>
          <QrSlip />
        </section>

        <section className="band" aria-labelledby="features-title">
          <h2 id="features-title">{copy.features.title}</h2>
          <div className="features">
            {copy.features.items.map((item) => (
              <article key={item.title} className="feature">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="band band-ink" aria-labelledby="privacy-title">
          <h2 id="privacy-title">{copy.privacy.title}</h2>
          <ul className="privacy">
            {copy.privacy.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="band" id="como-funciona" aria-labelledby="steps-title">
          <h2 id="steps-title">{copy.steps.title}</h2>
          <ol className="steps">
            {copy.steps.items.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="band" aria-labelledby="install-title">
          <h2 id="install-title">{copy.install.title}</h2>
          <dl className="install">
            {[copy.install.android, copy.install.iphone, copy.install.desktop].map((item) => (
              <div key={item.title}>
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="landing-footer">
        <p>{copy.footer.free}</p>
        <a href={REPO_URL} rel="noreferrer">
          {copy.footer.source}
        </a>
      </footer>
    </div>
  );
}
