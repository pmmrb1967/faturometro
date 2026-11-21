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
import { connectFromCloud } from '../../cloud/cloud-account';
import { forgetSignIn, signInToCloud } from '../../cloud/cloud-drives';
import type { CloudProvider } from '../../db/profiles';
import { cloudErrorText } from './cloud-errors';
import { useCloudReturn } from './cloud-return';
import { offeredServices, serviceOf, signInParts } from './cloud-service';

const copy = t.sync;

/** New device: sign in through a cloud or the sync server, and bring the data here. */
export function ConnectPage() {
  const back = useCloudReturn('connect');
  if (back.provider && back.accountId) {
    return (
      <CloudConnect provider={back.provider} accountId={back.accountId} onCancel={back.clear} />
    );
  }
  return <ServerConnect failed={back.failed ? back.provider : null} />;
}

function CloudConnect({
  provider,
  accountId,
  onCancel,
}: {
  provider: CloudProvider;
  accountId: string;
  onCancel: () => void;
}) {
  const service = serviceOf(provider);
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      // The first sync runs as soon as the app opens (automatic sync).
      signIn(await connectFromCloud({ password, ...signInParts(provider, accountId) }));
      forgetSignIn(provider, accountId);
      navigate('/app', { replace: true });
    } catch (caught) {
      setError(cloudErrorText(caught, service));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={copy.connect.title} intro={copy.cloud.enter.intro(service)}>
      <form onSubmit={submit} noValidate>
        <Field
          id="connect-cloud-password"
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FormError message={error} />
        <button type="submit" className="action-primary action-wide" disabled={busy || !password}>
          {busy ? copy.cloud.enter.working : copy.cloud.enter.submit}
        </button>
        <button
          type="button"
          className="action-secondary action-wide"
          disabled={busy}
          onClick={onCancel}
        >
          {copy.cloud.cancel}
        </button>
      </form>
    </AuthLayout>
  );
}

function ServerConnect({ failed }: { failed: CloudProvider | null }) {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SYNC_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<CloudProvider | null>(null);
  const offered = offeredServices();

  async function viaCloud(provider: CloudProvider) {
    setLeaving(provider);
    setError(undefined);
    try {
      await signInToCloud(provider, 'connect');
    } catch (caught) {
      setError(cloudErrorText(caught, serviceOf(provider)));
      setLeaving(null);
    }
  }

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
      {failed && <FormError message={copy.cloud.signInFailed(serviceOf(failed))} />}
      {offered.length > 0 && (
        <>
          {offered.map(({ provider, service }, index) => (
            <button
              key={provider}
              type="button"
              className={`${index === 0 ? 'action-primary' : 'action-secondary'} action-wide`}
              disabled={leaving !== null}
              onClick={() => void viaCloud(provider)}
            >
              {leaving === provider
                ? copy.cloud.redirecting(service)
                : copy.cloud.enter.button(service)}
            </button>
          ))}
          <p className="auth-alt">{copy.cloud.enter.or}</p>
        </>
      )}
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
        <button type="submit" className="action-primary action-wide" disabled={busy || !password}>
          {busy ? copy.connect.working : copy.connect.submit}
        </button>
      </form>
      <p className="auth-alt">
        <Link to="/entrar">{t.auth.recover.back}</Link>
      </p>
    </AuthLayout>
  );
}
