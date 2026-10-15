import { FeedbackLinks } from '../../components/FeedbackLinks';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { APP_BUILT, APP_COMMIT } from '../../app/build-info';
import { Field } from '../../components/Field';
import { isGuest } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import {
  changeAccountPassword,
  disableSync,
  enableSync,
  fileUsage,
  reconnectSync,
  setFileSync,
  SyncError,
} from '../../sync/account';
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { isValidServerUrl } from '../../sync/url';
import { InstallButton } from '../../components/InstallButton';
import { AiSettings } from '../ai/AiSettings';
import { AdminStatsSection } from './AdminStatsSection';
import { formatMegabytes } from './format';
import { BackupSection } from '../backup/BackupSection';
import { useSession } from '../auth/session-context';
import { validateNewPassword, type FieldErrors } from '../auth/validation';
import { syncSession, useSyncStatus } from '../sync/sync-store';
import { getSettings, updateSettings } from './settings';
import './settings.css';

const copy = t.sync;
const DEFAULT_SERVER = DEFAULT_SYNC_URL;

function errorText(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return (copy.errors as Record<string, string>)[code] ?? copy.errors.unexpected;
}

export function SettingsPage() {
  return (
    <>
      <h1>{t.settings.title}</h1>
      <AccountSection />
      <SyncSection />
      <AdminStatsSection />
      <AiSettings />
      <PreferencesSection />
      <AppSection />
      <FeedbackSection />
      <BackupSection />
    </>
  );
}

function SyncSection() {
  const { session, updateProfile } = useSession();
  const status = useSyncStatus();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string>();

  if (!session) return null;
  if (isGuest(session.profile)) {
    return (
      <section className="settings-section" aria-labelledby="sync-title">
        <h2 id="sync-title">{copy.title}</h2>
        <p>{t.guest.syncNeedsAccount}</p>
        <Link to="/criar-conta" className="action-primary">
          {t.guest.createAccount}
        </Link>
      </section>
    );
  }
  const sync = session.profile.sync;

  async function enable(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError(undefined);
    if (!isValidServerUrl(serverUrl.trim())) {
      setError(copy.errors.serverUrl);
      return;
    }
    setBusy(true);
    try {
      const profile = await enableSync({
        profile: session.profile,
        masterKey: session.masterKey,
        password,
        serverUrl: serverUrl.trim(),
      });
      setPassword('');
      updateProfile(profile);
      await syncSession({ ...session, profile }, updateProfile);
    } catch (caught) {
      setError(errorText(caught instanceof SyncError ? caught.code : 'unexpected'));
    } finally {
      setBusy(false);
    }
  }

  async function disable(deleteRemote: boolean) {
    if (!session) return;
    setBusy(true);
    setError(undefined);
    try {
      updateProfile(
        await disableSync({
          profile: session.profile,
          masterKey: session.masterKey,
          repos: session.repos,
          deleteRemote,
        }),
      );
      setNotice(copy.disabled);
    } catch (caught) {
      setError(errorText(caught instanceof SyncError ? caught.code : 'unexpected'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="sync-title">
      <h2 id="sync-title">{copy.title}</h2>
      {notice && !sync && (
        <p role="status" className="doc-saved">
          {notice}
        </p>
      )}

      {!sync && (
        <form onSubmit={enable} noValidate>
          <p>{copy.offIntro}</p>
          {status.error === 'account_removed' && (
            <p className="ingest-problem" role="alert">
              {copy.errors.account_removed}
            </p>
          )}
          <p className="muted">{copy.serverSees}</p>
          {/* Tells password managers which account the password belongs to. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={session.profile.email}
            readOnly
            hidden
          />
          <Field
            id="sync-server"
            label={copy.serverUrl}
            type="url"
            inputMode="url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
          />
          <Field
            id="sync-password"
            label={copy.password}
            hint={copy.passwordHint}
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
          <button type="submit" className="action-primary" disabled={busy || !password}>
            {busy ? copy.enabling : copy.enable}
          </button>
        </form>
      )}

      {sync && (
        <>
          <p>{copy.onIntro(new URL(sync.serverUrl).host)}</p>
          <p className="muted">
            {sync.lastSyncAt
              ? copy.lastSync(new Date(sync.lastSyncAt).toLocaleString('pt-PT'))
              : copy.never}
          </p>
          {status.running && <p role="status">{copy.syncing}</p>}
          {!status.running && status.lastReceived !== undefined && !status.error && (
            <p role="status">{copy.received(status.lastReceived)}</p>
          )}
          {!!status.lastConflicts && (
            <p className="ingest-problem">{copy.conflicts(status.lastConflicts)}</p>
          )}
          {(status.error || error) && (
            <p className="ingest-problem" role="alert">
              {error ?? errorText(status.error)}
            </p>
          )}
          {status.error === 'session_expired' && <ReconnectForm />}
          <FileSyncOption />
          <div className="ingest-actions">
            <button
              type="button"
              className="action-primary"
              disabled={status.running || busy}
              onClick={() => void syncSession(session, updateProfile)}
            >
              {copy.syncNow}
            </button>
          </div>

          <h3>{copy.disableTitle}</h3>
          <div className="ingest-actions">
            <button
              type="button"
              className="action-secondary"
              disabled={busy}
              onClick={() => void disable(false)}
            >
              {copy.disableLocal}
            </button>
          </div>
          <label className="check settings-check">
            <input
              type="checkbox"
              checked={confirmDelete}
              onChange={(event) => setConfirmDelete(event.target.checked)}
            />
            {copy.disableConfirm}
          </label>
          <button
            type="button"
            className="action-secondary danger"
            disabled={busy || !confirmDelete}
            onClick={() => void disable(true)}
          >
            {copy.disableDelete}
          </button>
        </>
      )}
    </section>
  );
}

function FileSyncOption() {
  const { session, updateProfile } = useSession();
  const status = useSyncStatus();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  // Shown at once; the saved value follows.
  const [pending, setPending] = useState<boolean>();
  const enabled = pending ?? Boolean(session?.profile.sync?.files);
  const usage = useLiveQuery(async () => {
    if (!session?.profile.sync || !enabled) return null;
    try {
      return await fileUsage(session);
    } catch {
      return null;
    }
  }, [session, enabled, status.files?.uploaded]);
  if (!session?.profile.sync) return null;

  async function toggle(checked: boolean) {
    if (!session) return;
    setPending(checked);
    const profile = await setFileSync(session.profile, checked);
    updateProfile(profile);
    setPending(undefined);
    if (checked) await syncSession({ ...session, profile }, updateProfile);
  }

  const files = status.files;
  return (
    <div className="file-sync">
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => void toggle(event.target.checked)}
        />
        {copy.files.label}
      </label>
      <p className="muted">{copy.files.hint}</p>
      {enabled && settings && !settings.keepOriginalFiles && (
        <p className="ingest-problem">{copy.files.needsKeep}</p>
      )}
      {enabled && usage && (
        <p className="muted">
          {copy.files.usage(formatMegabytes(usage.used), formatMegabytes(usage.quota))}
        </p>
      )}
      {enabled && usage && usage.keepMonths !== null && (
        <p className="muted">{copy.files.keep(usage.keepMonths)}</p>
      )}
      {enabled && files?.storageFull && <p className="ingest-problem">{copy.files.full}</p>}
      {enabled && !!files?.uploaded && <p role="status">{copy.files.sent(files.uploaded)}</p>}
      {enabled && !!files?.downloaded && (
        <p role="status">{copy.files.received(files.downloaded)}</p>
      )}
      {enabled && !!files?.pruned && <p role="status">{copy.files.pruned(files.pruned)}</p>}
    </div>
  );
}

/** Shown when the server session ended (e.g. password changed on another device). */
function ReconnectForm() {
  const { session, updateProfile } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(undefined);
    try {
      const profile = await reconnectSync({ ...session, password });
      setPassword('');
      updateProfile(profile);
      await syncSession({ ...session, profile }, updateProfile);
    } catch (caught) {
      setError(errorText(caught instanceof SyncError ? caught.code : 'unexpected'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={session.profile.email}
        readOnly
        hidden
      />
      <Field
        id="reconnect-password"
        label={copy.reconnect.password}
        hint={copy.reconnect.hint}
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
      <button type="submit" className="action-primary" disabled={busy || !password}>
        {busy ? copy.reconnect.working : copy.reconnect.submit}
      </button>
    </form>
  );
}

type PasswordFields = 'current' | 'password' | 'confirm';

function AccountSection() {
  const { session, updateProfile } = useSession();
  const [values, setValues] = useState<Record<PasswordFields, string>>({
    current: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<FieldErrors<PasswordFields>>({});
  const [formError, setFormError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  if (isGuest(session.profile)) return <GuestNotice />;
  const accountCopy = t.settings.account;

  const set = (field: PasswordFields) => (event: { target: { value: string } }) => {
    setDone(false);
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const found: FieldErrors<PasswordFields> = validateNewPassword(values.password, values.confirm);
    if (!values.current) found.current = t.auth.errors.required;
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const profile = await changeAccountPassword({
        ...session,
        currentPassword: values.current,
        newPassword: values.password,
      });
      updateProfile(profile);
      setValues({ current: '', password: '', confirm: '' });
      setDone(true);
    } catch (caught) {
      if (caught instanceof SyncError && caught.code === 'wrong_password') {
        setErrors({ current: copy.errors.wrong_password });
      } else {
        setFormError(errorText(caught instanceof SyncError ? caught.code : 'unexpected'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="account-title">
      <h2 id="account-title">{accountCopy.title}</h2>
      <p className="muted">{accountCopy.signedInAs(session.profile.email)}</p>
      {session.profile.sync?.admin && <p className="muted">{accountCopy.admin}</p>}
      <h3>{accountCopy.changePassword}</h3>
      {session.profile.sync && <p className="muted">{accountCopy.syncNote}</p>}
      <form onSubmit={submit} noValidate>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={session.profile.email}
          readOnly
          hidden
        />
        <Field
          id="account-current"
          label={accountCopy.current}
          type="password"
          autoComplete="current-password"
          value={values.current}
          onChange={set('current')}
          error={errors.current}
        />
        <Field
          id="account-new"
          label={accountCopy.next}
          hint={t.auth.passwordHint}
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <Field
          id="account-confirm"
          label={accountCopy.confirm}
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        {formError && (
          <p className="ingest-problem" role="alert">
            {formError}
          </p>
        )}
        {done && (
          <p role="status" className="doc-saved">
            {accountCopy.done} {accountCopy.recoveryNote}
          </p>
        )}
        <button type="submit" className="action-primary" disabled={busy}>
          {busy ? accountCopy.working : accountCopy.submit}
        </button>
      </form>
    </section>
  );
}

function FeedbackSection() {
  return (
    <section className="settings-section" aria-labelledby="feedback-title">
      <h2 id="feedback-title">{t.feedback.title}</h2>
      <p className="muted">{t.feedback.intro}</p>
      <FeedbackLinks />
    </section>
  );
}

function AppSection() {
  return (
    <section className="settings-section" aria-labelledby="app-title">
      <h2 id="app-title">{t.install.title}</h2>
      <p>{t.install.intro}</p>
      <InstallButton />
      <p className="muted">{t.install.dataNote}</p>
      <p className="muted">{t.install.version(APP_COMMIT, formatIsoDate(APP_BUILT))}</p>
    </section>
  );
}

function PreferencesSection() {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  if (!session || !settings) return null;

  const toggle =
    (field: 'largeFamily' | 'keepOriginalFiles') => (event: { target: { checked: boolean } }) =>
      void updateSettings(session.repos, { [field]: event.target.checked });

  return (
    <section className="settings-section" aria-labelledby="preferences-title">
      <h2 id="preferences-title">{t.settings.preferences}</h2>
      <label className="check settings-check">
        <input type="checkbox" checked={settings.largeFamily} onChange={toggle('largeFamily')} />
        {t.settings.largeFamily}
      </label>
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={settings.keepOriginalFiles}
          onChange={toggle('keepOriginalFiles')}
        />
        {t.settings.keepOriginalFiles}
      </label>
    </section>
  );
}

/** Instead of the account section: what using the app without an account means. */
function GuestNotice() {
  return (
    <section className="settings-section" aria-labelledby="guest-title">
      <h2 id="guest-title">{t.guest.noticeTitle}</h2>
      {t.guest.notice.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <Link to="/criar-conta" className="action-primary">
        {t.guest.createAccount}
      </Link>
    </section>
  );
}
