import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import { disableSync, enableSync, SyncError } from '../../sync/account';
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { isValidServerUrl } from '../../sync/url';
import { useSession } from '../auth/session-context';
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
      <SyncSection />
      <PreferencesSection />
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
        await disableSync({ profile: session.profile, masterKey: session.masterKey, deleteRemote }),
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
          <p className="muted">{copy.pdfNote}</p>
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
