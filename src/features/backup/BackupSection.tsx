import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Field } from '../../components/Field';
import { profilesDb } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { disableSync, SyncError } from '../../sync/account';
import { refreshAlerts, today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings, updateSettings } from '../settings/settings';
import { syncSession } from '../sync/sync-store';
import { AutoBackupSection } from './AutoBackupSection';
import { BACKUP_ANCHOR, BackupError, backupFileName, exportBackup, importBackup } from './backup';
import { decryptBackup, isEncryptedBackup } from './encrypted-backup';
import { SettingsBlock } from '../settings/SettingsBlock';
import { backupStatus } from '../settings/section-status';

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
  const [encrypted, setEncrypted] = useState<Uint8Array | null>(null);
  const [secret, setSecret] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const encryptedCopy = copy.encrypted;
  const { hash } = useLocation();
  const facts = useLiveQuery(
    async () =>
      session
        ? {
            settings: await getSettings(session.repos),
            auto: await profilesDb.autoBackups.get(session.profile.id),
          }
        : null,
    [session],
  );
  // The sections above wait for the settings and then grow, so scroll once they have loaded.
  const settingsLoaded = Boolean(facts);
  useEffect(() => {
    if (settingsLoaded && hash === `#${BACKUP_ANCHOR}`) {
      document.getElementById(BACKUP_ANCHOR)?.scrollIntoView();
    }
  }, [settingsLoaded, hash]);
  if (!session) return null;
  const { repos } = session;
  const synced = Boolean(session.profile.sync);
  const line = facts
    ? backupStatus({
        ...(facts.settings.lastBackupAt ? { lastExport: facts.settings.lastBackupAt } : {}),
        ...(facts.auto ? { auto: facts.auto } : {}),
      })
    : null;

  async function exportAll() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await exportBackup(repos);
      download(result.zip, backupFileName());
      await updateSettings(repos, { lastBackupAt: today() });
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
    setMessage(undefined);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isEncryptedBackup(bytes)) {
      setEncrypted(bytes);
      setSecret('');
      return;
    }
    await importBytes(bytes);
  }

  async function openEncrypted(event: FormEvent) {
    event.preventDefault();
    if (!encrypted || !secret) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const opened = await decryptBackup(
        encrypted,
        useRecovery ? { recoveryKey: secret } : { password: secret },
      );
      setEncrypted(null);
      setSecret('');
      await importBytes(opened);
    } catch (error) {
      // A wrong password keeps the chosen file and the form, to try again.
      setMessage({
        text: error instanceof BackupError ? copy.errors[error.code] : copy.failed,
        problem: true,
      });
      setBusy(false);
    }
  }

  async function importBytes(bytes: Uint8Array) {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await importBackup(repos, bytes);
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
      await profilesDb.autoBackups.delete(session.profile.id);
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
    <SettingsBlock
      id={BACKUP_ANCHOR}
      title={copy.title}
      {...(line ? { status: line.text, attention: line.attention } : {})}
    >
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

      <AutoBackupSection />

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
      {encrypted && (
        <form onSubmit={(event) => void openEncrypted(event)} noValidate>
          <p className="muted">{encryptedCopy.intro}</p>
          <Field
            id="encrypted-backup-secret"
            label={useRecovery ? encryptedCopy.recoveryKey : encryptedCopy.password}
            type={useRecovery ? 'text' : 'password'}
            autoComplete={useRecovery ? 'off' : 'current-password'}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          <p>
            <button
              type="button"
              className="action-secondary action-compact"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setSecret('');
              }}
            >
              {useRecovery ? encryptedCopy.usePassword : encryptedCopy.useRecoveryKey}
            </button>
          </p>
          <button type="submit" className="action-primary" disabled={busy || !secret}>
            {busy ? encryptedCopy.opening : encryptedCopy.open}
          </button>{' '}
          <button
            type="button"
            className="action-secondary"
            disabled={busy}
            onClick={() => {
              setEncrypted(null);
              setSecret('');
            }}
          >
            {encryptedCopy.cancel}
          </button>
        </form>
      )}

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
    </SettingsBlock>
  );
}
