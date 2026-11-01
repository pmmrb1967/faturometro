import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { profilesDb } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { disableSync, SyncError } from '../../sync/account';
import { refreshAlerts } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { syncSession } from '../sync/sync-store';
import { BACKUP_ANCHOR, BackupError, backupFileName, exportBackup, importBackup } from './backup';

const copy = t.backup;

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BackupSection() {
  const { session, lock, updateProfile } = useSession();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; problem?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteRemote, setDeleteRemote] = useState(true);
  const { hash } = useLocation();
  const section = useRef<HTMLElement>(null);
  // The sections above wait for the settings and then grow, so scroll once they have loaded.
  const settingsLoaded = useLiveQuery(
    async () => (session ? (await getSettings(session.repos), true) : false),
    [session],
  );
  useEffect(() => {
    if (settingsLoaded && hash === `#${BACKUP_ANCHOR}`) section.current?.scrollIntoView();
  }, [settingsLoaded, hash]);
  if (!session) return null;
  const { repos } = session;
  const synced = Boolean(session.profile.sync);

  async function exportAll() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await exportBackup(repos);
      download(result.zip, backupFileName());
      setMessage({ text: copy.exported(result.records, result.files) });
    } catch {
      setMessage({ text: copy.failed, problem: true });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await importBackup(repos, new Uint8Array(await file.arrayBuffer()));
      await refreshAlerts(repos);
      setMessage({ text: copy.imported(result.added, result.skipped, result.files) });
      // The other devices get it now, not at the next automatic sync.
      if (session && result.added + result.files > 0) void syncSession(session, updateProfile);
    } catch (error) {
      setMessage({
        text: error instanceof BackupError ? copy.errors[error.code] : copy.failed,
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteEverything() {
    if (!session) return;
    setBusy(true);
    setMessage(undefined);
    try {
      if (synced && deleteRemote) {
        await disableSync({ ...session, deleteRemote: true });
      }
      session.db.close();
      await session.db.delete();
      await profilesDb.profiles.delete(session.profile.id);
      lock();
      navigate('/', { replace: true });
    } catch (error) {
      setMessage({
        text:
          error instanceof SyncError
            ? ((t.sync.errors as Record<string, string>)[error.code] ?? copy.failed)
            : copy.failed,
        problem: true,
      });
      setBusy(false);
    }
  }

  return (
    <section ref={section} className="settings-section" aria-labelledby="backup-title">
      <h2 id="backup-title">{copy.title}</h2>
      {!synced && <p className="ingest-problem">{copy.localOnlyWarning}</p>}

      <h3>{copy.exportTitle}</h3>
      <p className="muted">{copy.exportHint}</p>
      <button
        type="button"
        className="action-primary"
        disabled={busy}
        onClick={() => void exportAll()}
      >
        {copy.export}
      </button>

      <h3>{copy.importTitle}</h3>
      <p className="muted">{copy.importHint}</p>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => void importFile(event)}
      />
      <button
        type="button"
        className="action-secondary"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        {copy.import}
      </button>

      {message && (
        <p className={message.problem ? 'ingest-problem' : 'doc-saved'} role="status">
          {message.text}
        </p>
      )}

      <h3>{copy.deleteTitle}</h3>
      <p className="muted">{copy.deleteHint}</p>
      {synced && (
        <label className="check settings-check">
          <input
            type="checkbox"
            checked={deleteRemote}
            onChange={(event) => setDeleteRemote(event.target.checked)}
          />
          {copy.deleteRemote}
        </label>
      )}
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={confirmDelete}
          onChange={(event) => setConfirmDelete(event.target.checked)}
        />
        {copy.deleteConfirm}
      </label>
      <button
        type="button"
        className="action-secondary danger"
        disabled={busy || !confirmDelete}
        onClick={() => void deleteEverything()}
      >
        {copy.delete}
      </button>
    </section>
  );
}
