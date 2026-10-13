import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { AccountError, listAccountEmails, unlockAccount } from './accounts';
import { AuthLayout, Field, FormError } from './AuthLayout';
import { useSession } from './session-context';
import { required, validateEmail } from './validation';

function useReturnPath(): string {
  const state: unknown = useLocation().state;
  if (state && typeof state === 'object' && 'from' in state && typeof state.from === 'string') {
    return state.from.startsWith('/app') ? state.from : '/app';
  }
  return '/app';
}

export function LoginPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listAccountEmails().then((found) => {
      setEmails(found);
      if (found.length === 1 && found[0]) setEmail(found[0]);
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = { email: validateEmail(email), password: required(password) };
    setErrors(found);
    setFormError(undefined);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      signIn(await unlockAccount(email, password));
      navigate(returnPath, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof AccountError ? t.auth.errors[error.code] : t.auth.errors.unexpected,
      );
      setBusy(false);
    }
  }

  const copy = t.auth.login;
  return (
    <AuthLayout title={copy.title} intro={copy.intro}>
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
      <p className="auth-alt">
        <Link to="/recuperar">{copy.forgot}</Link>
      </p>
      <p className="auth-alt">
        <Link to="/criar-conta">{copy.createAccount}</Link>
      </p>
      <p className="auth-alt">
        <Link to="/entrar-sincronizado">{t.sync.connect.link}</Link>
      </p>
    </AuthLayout>
  );
}
