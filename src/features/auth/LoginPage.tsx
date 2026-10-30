import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { countSharedFiles } from '../../app/shared-files';
import { t } from '../../i18n/pt-PT';
import {
  AccountError,
  createGuest,
  listAccountEmails,
  openGuest,
  unlockAccount,
  type UnlockedAccount,
} from './accounts';
import { AuthLayout, Field, FormError } from './AuthLayout';
import { afterSignIn, loginGreeting } from './entry';
import { useSession } from './session-context';
import { required, validateEmail } from './validation';

export function LoginPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<string[] | null>(null);
  // undefined while checking; null when this device has no guest yet.
  const [guest, setGuest] = useState<UnlockedAccount | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listAccountEmails().then((found) => {
      setEmails(found);
      if (found.length === 1 && found[0]) {
        setEmail(found[0]);
        // The email is known: start on the password.
        document.getElementById('password')?.focus();
      }
    });
    void openGuest().then(setGuest);
  }, []);

  // An installed app opens here with no profile: it must be able to start without an account.
  async function continueGuest() {
    if (guest === undefined) return;
    const account = guest ?? (await createGuest());
    const next = afterSignIn(await countSharedFiles());
    signIn(account);
    navigate(next, { replace: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = { email: validateEmail(email), password: required(password) };
    setErrors(found);
    setFormError(undefined);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      const account = await unlockAccount(email, password);
      const next = afterSignIn(await countSharedFiles());
      signIn(account);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof AccountError ? t.auth.errors[error.code] : t.auth.errors.unexpected,
      );
      setBusy(false);
    }
  }

  const copy = t.auth.login;
  const greeting = loginGreeting(emails === null ? null : emails.length);
  return (
    <AuthLayout
      title={greeting === 'none' ? copy.title : copy.returningTitle}
      intro={
        greeting === 'none' ? copy.intro : greeting === 'many' ? copy.introMany : copy.introOne
      }
    >
      {emails?.length === 0 && (
        <p className="auth-notice">
          {copy.noAccounts} <Link to="/criar-conta">{copy.createAccount}</Link>
        </p>
      )}
      <form onSubmit={submit} noValidate>
        <Field
          id="email"
          label={t.auth.email}
          type="email"
          autoComplete="username"
          list="known-emails"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <datalist id="known-emails">
          {emails?.map((known) => (
            <option key={known} value={known} />
          ))}
        </datalist>
        <Field
          id="password"
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />
        <FormError message={formError} />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? t.auth.working : copy.submit}
        </button>
      </form>
      {guest !== undefined && (
        <p className="auth-alt">
          <button type="button" className="link-button" onClick={() => void continueGuest()}>
            {guest ? copy.continueGuest : copy.startGuest}
          </button>
        </p>
      )}
      <p className="auth-alt">
        <Link to="/recuperar">{copy.forgot}</Link>
      </p>
      <p className="auth-alt">
        <Link to="/criar-conta">{copy.createAccount}</Link>
      </p>
      <p className="auth-alt">
        <span className="auth-question">{t.sync.connect.question}</span>
        <Link to="/entrar-sincronizado">{t.sync.connect.link}</Link>
      </p>
    </AuthLayout>
  );
}
