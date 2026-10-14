import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Field } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import { connectFromServer, SyncError } from '../../sync/account';
import { AuthLayout, FormError } from '../auth/AuthLayout';
import { useSession } from '../auth/session-context';
import { validateEmail } from '../auth/validation';
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { isValidServerUrl } from '../../sync/url';

const copy = t.sync;

/** New device: sign in to the sync server and bring the data here. */
export function ConnectPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SYNC_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!isValidServerUrl(serverUrl.trim())) return setError(copy.errors.serverUrl);
    const emailError = validateEmail(email);
    if (emailError) return setError(emailError);
    setBusy(true);
    try {
      // The first sync runs as soon as the app opens (automatic sync).
      signIn(await connectFromServer({ serverUrl: serverUrl.trim(), email, password }));
      navigate('/app', { replace: true });
    } catch (caught) {
      const code = caught instanceof SyncError ? caught.code : 'unexpected';
      setError(
        code === 'wrong_credentials'
          ? copy.connect.wrongCredentials
          : ((copy.errors as Record<string, string>)[code] ?? copy.errors.unexpected),
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={copy.connect.title} intro={copy.connect.intro}>
      <form onSubmit={submit} noValidate>
        <Field
          id="connect-server"
          label={copy.serverUrl}
          type="url"
          inputMode="url"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
        />
        <Field
          id="connect-email"
          label={t.auth.email}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          id="connect-password"
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FormError message={error} />
        <button type="submit" className="auth-submit" disabled={busy || !password}>
          {busy ? copy.connect.working : copy.connect.submit}
        </button>
      </form>
      <p className="auth-alt">
        <Link to="/entrar">{t.auth.recover.back}</Link>
      </p>
    </AuthLayout>
  );
}
