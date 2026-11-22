/** Sync through the user's cloud (OneDrive, Google Drive, Dropbox): turning it on, its panel, moving from the server. */
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { enableCloudSync, relinkCloud } from '../../cloud/cloud-account';
import { forgetSignIn, signInToCloud } from '../../cloud/cloud-drives';
import { disableCloudSync, setCloudFileSync } from '../../cloud/cloud-run';
import { finishServerData, migrateToCloud } from '../../cloud/migrate';
import type { CloudProvider, ProfileSync } from '../../db/profiles';
import { orList, t, type CloudService } from '../../i18n/pt-PT';
import { disableSync } from '../../sync/account';
import { linkAdmin } from '../../sync/admin-link';
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { useSession } from '../auth/session-context';
import { cloudErrorText } from './cloud-errors';
import { useCloudReturn, type CloudIntent } from './cloud-return';
import { offeredServices, serviceOf, signInParts } from './cloud-service';
import { syncSession, useSyncStatus } from './sync-store';
import { submittedPassword } from '../../lib/submitted-password';

const copy = t.sync.cloud;

function SignInButton({
  provider,
  intent,
  label,
  primary = true,
  before,
}: {
  provider: CloudProvider;
  intent: CloudIntent;
  label: string;
  primary?: boolean;
  /** Runs just before leaving for the sign-in page. */
  before?: () => Promise<void>;
}) {
  const service = serviceOf(provider);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setLeaving(true);
    setError(undefined);
    try {
      await before?.();
      await signInToCloud(provider, intent);
    } catch (caught) {
      setError(cloudErrorText(caught, service));
      setLeaving(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={primary ? 'action-primary' : 'action-secondary'}
        disabled={leaving}
        onClick={() => void go()}
      >
        {leaving ? copy.redirecting(service) : label}
      </button>
      {error && (
        <p className="ingest-problem" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The sign-in did not finish: say so, once. */
function SignInFailed({ provider }: { provider: CloudProvider | null }) {
  if (!provider) return null;
  return (
    <p className="ingest-problem" role="alert">
      {copy.signInFailed(serviceOf(provider))}
    </p>
  );
}

/** Back from the service: the account's password, then `run`. */
function PasswordStep({
  intro,
  submit,
  working,
  service,
  run,
  onCancel,
}: {
  intro: string;
  submit: string;
  working: string;
  service: CloudService;
  run: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { session } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function send(event: FormEvent) {
    event.preventDefault();
    const entered = submittedPassword(event, password);
    if (!entered) return;
    setBusy(true);
    setError(undefined);
    try {
      await run(entered);
      setPassword('');
    } catch (caught) {
      setError(cloudErrorText(caught, service));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} noValidate>
      <p>{intro}</p>
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={session?.profile.email ?? ''}
        readOnly
        hidden
      />
      <Field
        id="cloud-password"
        label={t.sync.password}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && (
        <p className="ingest-problem" role="alert">
          {error}
        </p>
      )}
      <div className="ingest-actions">
        <button type="submit" className="action-primary" disabled={busy}>
          {busy ? working : submit}
        </button>
        <button type="button" className="action-secondary" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}

/** No sync yet: the clouds this build offers, first and recommended. */
export function CloudChoice() {
  const { session, updateProfile } = useSession();
  const back = useCloudReturn('enable');
  if (!session) return null;
  const offered = offeredServices();
  const { provider, accountId } = back;

  async function enable(password: string) {
    if (!session || !provider || !accountId) return;
    const profile = await enableCloudSync({
      profile: session.profile,
      masterKey: session.masterKey,
      password,
      ...signInParts(provider, accountId),
    });
    forgetSignIn(provider, accountId);
    back.clear();
    updateProfile(profile);
    await syncSession({ ...session, profile }, updateProfile);
  }

  return (
    <>
      <h3>{copy.title}</h3>
      <p>{copy.intro(orList(offered.map(({ service }) => service.name)))}</p>
      <p className="muted">{copy.sees}</p>
      {back.failed && <SignInFailed provider={provider} />}
      {provider && accountId ? (
        <PasswordStep
          intro={copy.confirmIntro(serviceOf(provider))}
          submit={copy.confirm(serviceOf(provider))}
          working={copy.confirming}
          service={serviceOf(provider)}
          run={enable}
          onCancel={back.clear}
        />
      ) : (
        <div className="ingest-actions">
          {offered.map(({ provider: each, service }, index) => (
            <SignInButton
              key={each}
              provider={each}
              intent="enable"
              label={copy.connect(service)}
              primary={index === 0}
            />
          ))}
        </div>
      )}
      <h3>{copy.serverTitle}</h3>
      <p className="muted">{copy.serverIntro}</p>
    </>
  );
}

/** Syncing through the user's cloud. */
export function CloudPanel({
  previous,
  onFinished,
}: {
  /** Just moved from the server: what to do with the data there. */
  previous: ProfileSync | null;
  onFinished: () => void;
}) {
  const { session, updateProfile } = useSession();
  const status = useSyncStatus();
  const back = useCloudReturn('reconnect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const cloud = session?.profile.cloud;
  const provider = cloud?.provider ?? 'onedrive';
  const service = serviceOf(provider);
  const relinkTo = back.provider === provider ? back.accountId : null;
  const { clear } = back;

  // Back from "Ligar de novo": keep the new sign-in if it opens this account's folder.
  useEffect(() => {
    if (!session || !relinkTo) return;
    const { drive, accountId, refreshToken } = signInParts(provider, relinkTo);
    void relinkCloud({
      profile: session.profile,
      drive,
      masterKey: session.masterKey,
      ...(accountId ? { accountId } : {}),
      ...(refreshToken ? { refreshToken } : {}),
    })
      .then(async (profile) => {
        forgetSignIn(provider, relinkTo);
        clear();
        setError(undefined);
        updateProfile(profile);
        await syncSession({ ...session, profile }, updateProfile);
      })
      .catch((caught: unknown) => {
        forgetSignIn(provider, relinkTo);
        clear();
        setError(cloudErrorText(caught, service));
      });
    // Only when a sign-in comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relinkTo]);

  if (!session || !cloud) return null;

  async function toggleFiles(enabled: boolean) {
    if (!session) return;
    const profile = await setCloudFileSync(session.profile, enabled);
    updateProfile(profile);
    if (enabled) await syncSession({ ...session, profile }, updateProfile);
  }

  async function disable() {
    if (!session) return;
    setBusy(true);
    try {
      updateProfile(await disableCloudSync(session.profile, session.repos));
      setNotice(copy.disabled(service));
    } finally {
      setBusy(false);
    }
  }

  const files = status.files;
  return (
    <>
      {previous && <FinishServerChoice previous={previous} service={service} onDone={onFinished} />}
      <p>{copy.onIntro(service, cloud.accountLabel)}</p>
      <p className="muted">
        {cloud.lastSyncAt
          ? t.sync.lastSync(new Date(cloud.lastSyncAt).toLocaleString('pt-PT'))
          : t.sync.never}
      </p>
      {status.running && <p role="status">{t.sync.syncing}</p>}
      {!status.running && status.lastReceived !== undefined && !status.error && (
        <p role="status">{t.sync.received(status.lastReceived)}</p>
      )}
      {!!status.lastConflicts && (
        <p className="ingest-problem">{t.sync.conflicts(status.lastConflicts)}</p>
      )}
      {back.failed && back.provider === provider && <SignInFailed provider={provider} />}
      {(status.error || error) && (
        <p className="ingest-problem" role="alert">
          {error ??
            (status.error === 'offline'
              ? copy.offline(service)
              : ((t.sync.errors as Record<string, string>)[status.error ?? ''] ??
                t.sync.errors.unexpected))}
        </p>
      )}
      {status.error === 'needs_reconnect' && (
        <SignInButton provider={provider} intent="reconnect" label={copy.reconnect(service)} />
      )}
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={Boolean(cloud.files)}
          onChange={(event) => void toggleFiles(event.target.checked)}
        />
        {copy.files.label}
      </label>
      <p className="muted">{copy.files.hint(service)}</p>
      {files && files.uploaded > 0 && <p role="status">{t.sync.files.sent(files.uploaded)}</p>}
      {files && files.downloaded > 0 && (
        <p role="status">{t.sync.files.received(files.downloaded)}</p>
      )}
      {files?.storageFull && <p className="ingest-problem">{copy.files.full(service)}</p>}
      <div className="ingest-actions">
        <button
          type="button"
          className="action-primary"
          disabled={status.running || busy}
          onClick={() => void syncSession(session, updateProfile)}
        >
          {t.sync.syncNow}
        </button>
      </div>
      {!session.profile.adminLink && <AdminLinkForm />}
      <h3>{t.sync.disableTitle}</h3>
      <p className="muted">{copy.disableHint(service)}</p>
      <button
        type="button"
        className="action-secondary"
        disabled={busy}
        onClick={() => void disable()}
      >
        {copy.disable(service)}
      </button>
      {notice && (
        <p role="status" className="doc-saved">
          {notice}
        </p>
      )}
    </>
  );
}

/** Syncing through the server: move to the user's cloud. */
export function MoveToCloud({ onMoved }: { onMoved: (previous: ProfileSync) => void }) {
  const { session, updateProfile } = useSession();
  const back = useCloudReturn('migrate');
  if (!session) return null;
  const { provider, accountId } = back;

  async function move(password: string) {
    if (!session || !provider || !accountId) return;
    const moved = await migrateToCloud({
      profile: session.profile,
      masterKey: session.masterKey,
      repos: session.repos,
      password,
      ...signInParts(provider, accountId),
    });
    forgetSignIn(provider, accountId);
    back.clear();
    updateProfile(moved.profile);
    onMoved(moved.previous);
  }

  return (
    <>
      <h3>{copy.move.title}</h3>
      <p className="muted">{copy.move.intro}</p>
      {back.failed && <SignInFailed provider={provider} />}
      {provider && accountId ? (
        <PasswordStep
          intro={copy.confirmIntro(serviceOf(provider))}
          submit={copy.move.button(serviceOf(provider))}
          working={copy.move.working(serviceOf(provider))}
          service={serviceOf(provider)}
          run={move}
          onCancel={back.clear}
        />
      ) : (
        <div className="ingest-actions">
          {offeredServices().map(({ provider: each, service }) => (
            <SignInButton
              key={each}
              provider={each}
              intent="migrate"
              label={copy.move.button(service)}
              primary={false}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Another device moved the account to a cloud: turn it on here too. */
export function MovedNotice() {
  const { session, updateProfile } = useSession();
  if (!session) return null;
  // Off here first (the server data stays for the other devices), then the sign-in.
  async function turnOffServer() {
    if (!session) return;
    updateProfile(
      await disableSync({
        profile: session.profile,
        masterKey: session.masterKey,
        deleteRemote: false,
      }),
    );
  }
  return (
    <>
      <p>{copy.moved.intro}</p>
      <div className="ingest-actions">
        {offeredServices().map(({ provider, service }) => (
          <SignInButton
            key={provider}
            provider={provider}
            intent="enable"
            label={copy.moved.action(service)}
            before={turnOffServer}
          />
        ))}
      </div>
    </>
  );
}

function FinishServerChoice({
  previous,
  service,
  onDone,
}: {
  previous: ProfileSync;
  service: CloudService;
  onDone: () => void;
}) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  if (!session) return null;
  async function finish(deleteData: boolean) {
    if (!session) return;
    setBusy(true);
    setError(undefined);
    try {
      await finishServerData({ previous, masterKey: session.masterKey, deleteData });
      setDone(deleteData ? copy.move.deleted : copy.move.kept);
    } catch (caught) {
      setError(cloudErrorText(caught));
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <p role="status" className="doc-saved">
        {done}{' '}
        <button type="button" className="action-secondary action-compact" onClick={onDone}>
          {copy.move.close}
        </button>
      </p>
    );
  }
  return (
    <div role="status">
      <p className="doc-saved">{copy.move.done(service)}</p>
      <p>{copy.move.question}</p>
      {previous.admin && <p className="muted">{copy.move.admin}</p>}
      <p className="muted">{copy.move.deleteHint}</p>
      <p className="muted">{copy.move.keepHint}</p>
      {error && (
        <p className="ingest-problem" role="alert">
          {error}
        </p>
      )}
      <div className="ingest-actions">
        <button
          type="button"
          className="action-secondary danger"
          disabled={busy}
          onClick={() => void finish(true)}
        >
          {copy.move.delete}
        </button>
        <button
          type="button"
          className="action-secondary"
          disabled={busy}
          onClick={() => void finish(false)}
        >
          {copy.move.keep}
        </button>
      </div>
    </div>
  );
}

/** Administrators syncing through their cloud: link to the server for the admin tools. */
function AdminLinkForm() {
  const { session, updateProfile } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!session) return null;
  async function link(event: FormEvent) {
    event.preventDefault();
    const entered = submittedPassword(event, password);
    if (!session || !entered) return;
    setBusy(true);
    setError(undefined);
    try {
      updateProfile(
        await linkAdmin({
          profile: session.profile,
          masterKey: session.masterKey,
          password: entered,
          serverUrl: DEFAULT_SYNC_URL,
        }),
      );
      setPassword('');
    } catch (caught) {
      setError(cloudErrorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>{copy.admin.summary}</summary>
      <form onSubmit={link} noValidate>
        <p className="muted">{copy.admin.intro}</p>
        <Field
          id="admin-link-password"
          label={copy.admin.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p className="ingest-problem" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="action-secondary" disabled={busy}>
          {busy ? copy.admin.working : copy.admin.submit}
        </button>
      </form>
    </details>
  );
}
