/** Sync through the user's OneDrive: turning it on, its panel, moving from the server. */
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { enableCloudSync, relinkCloud } from '../../cloud/cloud-account';
import { oneDriveFor } from '../../cloud/cloud-drives';
import { disableCloudSync, setCloudFileSync } from '../../cloud/cloud-run';
import { finishServerData, migrateToCloud } from '../../cloud/migrate';
import { signInToOneDrive } from '../../cloud/onedrive-auth';
import type { ProfileSync } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { disableSync } from '../../sync/account';
import { linkAdmin } from '../../sync/admin-link';
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { useSession } from '../auth/session-context';
import { cloudErrorText } from './cloud-errors';
import { useOneDriveReturn, type OneDriveIntent } from './onedrive-return';
import { syncSession, useSyncStatus } from './sync-store';

const copy = t.sync.cloud;

function SignInButton({
  intent,
  label,
  primary = true,
}: {
  intent: OneDriveIntent;
  label: string;
  primary?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setLeaving(true);
    setError(undefined);
    try {
      await signInToOneDrive(intent);
    } catch (caught) {
      setError(cloudErrorText(caught));
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
        {leaving ? copy.redirecting : label}
      </button>
      {error && (
        <p className="ingest-problem" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Back from Microsoft: the account's password, then `run`. */
function PasswordStep({
  intro,
  submit,
  working,
  run,
  onCancel,
}: {
  intro: string;
  submit: string;
  working: string;
  run: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { session } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await run(password);
      setPassword('');
    } catch (caught) {
      setError(cloudErrorText(caught));
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
        <button type="submit" className="action-primary" disabled={busy || !password}>
          {busy ? working : submit}
        </button>
        <button type="button" className="action-secondary" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}

/** No sync yet: the OneDrive option, first and recommended. */
export function OneDriveChoice() {
  const { session, updateProfile } = useSession();
  const back = useOneDriveReturn('enable');
  if (!session) return null;
  const { accountId } = back;

  async function enable(password: string) {
    if (!session || !accountId) return;
    const profile = await enableCloudSync({
      profile: session.profile,
      masterKey: session.masterKey,
      password,
      drive: oneDriveFor(accountId),
      provider: 'onedrive',
      accountId,
    });
    back.clear();
    updateProfile(profile);
    await syncSession({ ...session, profile }, updateProfile);
  }

  return (
    <>
      <h3>{copy.title}</h3>
      <p>{copy.intro}</p>
      <p className="muted">{copy.sees}</p>
      {accountId ? (
        <PasswordStep
          intro={copy.confirmIntro}
          submit={copy.confirm}
          working={copy.confirming}
          run={enable}
          onCancel={back.clear}
        />
      ) : (
        <SignInButton intent="enable" label={copy.connect} />
      )}
      <h3>{copy.serverTitle}</h3>
      <p className="muted">{copy.serverIntro}</p>
    </>
  );
}

/** Syncing through OneDrive. */
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
  const back = useOneDriveReturn('reconnect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const cloud = session?.profile.cloud;
  const relinkTo = back.accountId;
  const { clear } = back;

  // Back from "Ligar de novo": keep the new sign-in if it opens this account's folder.
  useEffect(() => {
    if (!session || !relinkTo) return;
    void relinkCloud({
      profile: session.profile,
      drive: oneDriveFor(relinkTo),
      accountId: relinkTo,
    })
      .then(async (profile) => {
        clear();
        setError(undefined);
        updateProfile(profile);
        await syncSession({ ...session, profile }, updateProfile);
      })
      .catch((caught: unknown) => {
        clear();
        setError(cloudErrorText(caught));
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
      setNotice(copy.disabled);
    } finally {
      setBusy(false);
    }
  }

  const files = status.files;
  return (
    <>
      {previous && <FinishServerChoice previous={previous} onDone={onFinished} />}
      <p>{copy.onIntro(cloud.accountLabel)}</p>
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
      {(status.error || error) && (
        <p className="ingest-problem" role="alert">
          {error ??
            (status.error === 'offline'
              ? copy.offline
              : ((t.sync.errors as Record<string, string>)[status.error ?? ''] ??
                t.sync.errors.unexpected))}
        </p>
      )}
      {status.error === 'needs_reconnect' && (
        <SignInButton intent="reconnect" label={copy.reconnect} />
      )}
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={Boolean(cloud.files)}
          onChange={(event) => void toggleFiles(event.target.checked)}
        />
        {copy.files.label}
      </label>
      <p className="muted">{copy.files.hint}</p>
      {files && files.uploaded > 0 && <p role="status">{t.sync.files.sent(files.uploaded)}</p>}
      {files && files.downloaded > 0 && (
        <p role="status">{t.sync.files.received(files.downloaded)}</p>
      )}
      {files?.storageFull && <p className="ingest-problem">{copy.files.full}</p>}
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
      <p className="muted">{copy.disableHint}</p>
      <button
        type="button"
        className="action-secondary"
        disabled={busy}
        onClick={() => void disable()}
      >
        {copy.disable}
      </button>
      {notice && (
        <p role="status" className="doc-saved">
          {notice}
        </p>
      )}
    </>
  );
}

/** Syncing through the server: move to OneDrive. */
export function MoveToCloud({ onMoved }: { onMoved: (previous: ProfileSync) => void }) {
  const { session, updateProfile } = useSession();
  const back = useOneDriveReturn('migrate');
  if (!session) return null;
  const { accountId } = back;

  async function move(password: string) {
    if (!session || !accountId) return;
    const moved = await migrateToCloud({
      profile: session.profile,
      masterKey: session.masterKey,
      repos: session.repos,
      drive: oneDriveFor(accountId),
      password,
      accountId,
    });
    back.clear();
    updateProfile(moved.profile);
    onMoved(moved.previous);
  }

  return (
    <>
      <h3>{copy.move.title}</h3>
      <p className="muted">{copy.move.intro}</p>
      {accountId ? (
        <PasswordStep
          intro={copy.confirmIntro}
          submit={copy.move.button}
          working={copy.move.working}
          run={move}
          onCancel={back.clear}
        />
      ) : (
        <SignInButton intent="migrate" label={copy.move.button} primary={false} />
      )}
    </>
  );
}

/** Another device moved the account to OneDrive: turn it on here too. */
export function MovedNotice() {
  const { session, updateProfile } = useSession();
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  async function go() {
    if (!session) return;
    setBusy(true);
    try {
      // Off here (the server data stays for the other devices), then the OneDrive sign-in.
      updateProfile(
        await disableSync({
          profile: session.profile,
          masterKey: session.masterKey,
          deleteRemote: false,
        }),
      );
      await signInToOneDrive('enable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ingest-actions">
      <button type="button" className="action-primary" disabled={busy} onClick={() => void go()}>
        {busy ? copy.redirecting : copy.moved.action}
      </button>
    </div>
  );
}

function FinishServerChoice({ previous, onDone }: { previous: ProfileSync; onDone: () => void }) {
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
      <p className="doc-saved">{copy.move.done}</p>
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
    if (!session) return;
    setBusy(true);
    setError(undefined);
    try {
      updateProfile(
        await linkAdmin({
          profile: session.profile,
          masterKey: session.masterKey,
          password,
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
        <button type="submit" className="action-secondary" disabled={busy || !password}>
          {busy ? copy.admin.working : copy.admin.submit}
        </button>
      </form>
    </details>
  );
}
