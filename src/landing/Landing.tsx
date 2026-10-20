import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { InstallButton } from '../components/InstallButton';
import { LegalFooter } from '../components/LegalFooter';
import { createGuest, listAccountEmails, openGuest } from '../features/auth/accounts';
import { useSession } from '../features/auth/session-context';
import { t } from '../i18n/pt-PT';
import { landingAction, showsTopSignIn } from './landing-action';
import { QrSlip } from './QrSlip';
import './landing.css';

const copy = t.landing;

export function Landing() {
  const { session, signIn } = useSession();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState({ hasGuest: false, accounts: 0 });
  useEffect(() => {
    void Promise.all([openGuest(), listAccountEmails()]).then(([guest, emails]) =>
      setProfiles({ hasGuest: guest !== null, accounts: emails.length }),
    );
  }, []);
  const action = landingAction({ signedIn: session !== null, ...profiles });

  async function startGuest() {
    signIn(await createGuest());
    navigate('/app');
  }

  return (
    <div className="landing">
      <header className="landing-bar">
        <Link to="/" className="landing-brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          {t.appName}
        </Link>
        {showsTopSignIn(action) && (
          <Link to="/entrar" className="button button-quiet">
            {copy.signIn}
          </Link>
        )}
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>{copy.hero.title}</h1>
            <p className="hero-lead">{copy.hero.lead}</p>
            <div className="hero-actions">
              {action === 'open' && (
                <Link to="/app" className="button button-primary">
                  {copy.openApp}
                </Link>
              )}
              {action === 'signIn' && (
                <Link to="/entrar" className="button button-primary">
                  {copy.signIn}
                </Link>
              )}
              {(action === 'startGuest' || action === 'continueGuest') && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void startGuest()}
                >
                  {action === 'continueGuest' ? copy.continueGuest : copy.startGuest}
                </button>
              )}
              {action === 'signIn' && (
                // Accounts here but no guest: starting without one stays possible.
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => void startGuest()}
                >
                  {copy.startGuest}
                </button>
              )}
              {action !== 'open' && (
                <Link to="/criar-conta" className="button button-quiet">
                  {copy.createAccount}
                </Link>
              )}
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
          <div className="landing-install">
            <InstallButton className="button button-primary" />
          </div>
        </section>
      </main>

      <div className="landing-footer-wrap">
        <p className="landing-free">{copy.footer.free}</p>
        <LegalFooter className="landing-footer" />
      </div>
    </div>
  );
}
