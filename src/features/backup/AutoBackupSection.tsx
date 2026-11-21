import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { SelectField } from '../../components/Field';
import {
  AUTO_BACKUP_KEEP,
  type AutoBackupEvery,
  type AutoBackupKeep,
} from '../../domain/auto-backup';
import { DEFAULT_AUTO_BACKUP, isGuest, profilesDb, type AutoBackupConfig } from '../../db/profiles';
import { t, type CloudService } from '../../i18n/pt-PT';
import { serviceOf } from '../sync/cloud-service';
import { useSession } from '../auth/session-context';
import type { AutoBackupOutcome } from './auto-backup-run';
import { backupNow, useAutoBackupState } from './auto-backup-store';
import { pickBackupFolder, supportsFolderBackup } from './fs-access';

const copy = t.backup.auto;
const EVERY: readonly AutoBackupEvery[] = ['week', 'day', 'month'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}

/** What the last run means for the user; null when there is nothing to say. */
function autoBackupMessage(
  outcome: AutoBackupOutcome | undefined,
  service: CloudService | null,
): { text: string; problem: boolean } | null {
  if (!outcome || outcome.kind === 'not_due') return null;
  if (outcome.kind === 'written') return { text: copy.written(outcome.name), problem: false };
  if (outcome.kind === 'needs_permission') {
    return {
      text: service ? copy.cloudNeedsReconnect(service) : copy.needsPermission,
      problem: true,
    };
  }
  return { text: copy.errors[outcome.code], problem: true };
}

export function AutoBackupSection() {
  const { session } = useSession();
  const { running, outcome } = useAutoBackupState();
  const [picking, setPicking] = useState(false);
  const profileId = session?.profile.id;
  const config = useLiveQuery(
    async () => (profileId ? ((await profilesDb.autoBackups.get(profileId)) ?? null) : null),
    [profileId],
  );
  if (!session || config === undefined) return null;
  const guest = isGuest(session.profile);
  const cloudLinked = Boolean(session.profile.cloud);
  const folders = supportsFolderBackup();
  const toCloud = config?.target === 'cloud';
  const service = session.profile.cloud ? serviceOf(session.profile.cloud.provider) : null;

  if (!folders && !cloudLinked) {
    return (
      <>
        <h3>{copy.title}</h3>
        <p className="muted">{copy.unsupported}</p>
      </>
    );
  }

  async function save(patch: Partial<AutoBackupConfig>) {
    if (!config) return;
    await profilesDb.autoBackups.put({ ...config, ...patch });
  }

  async function chooseFolder() {
    if (!session) return;
    setPicking(true);
    try {
      const dir = await pickBackupFolder();
      if (!dir) return;
      const base = config ?? { profileId: session.profile.id, ...DEFAULT_AUTO_BACKUP };
      const next: AutoBackupConfig = {
        ...base,
        target: 'folder',
        dir,
        dirName: dir.name,
        encrypted: guest ? false : base.encrypted,
      };
      delete next.lastError;
      await profilesDb.autoBackups.put(next);
      await backupNow(session);
    } finally {
      setPicking(false);
    }
  }

  /** To `copias/` in the linked cloud: works in any browser. */
  async function chooseCloud() {
    if (!session) return;
    const base = config ?? { profileId: session.profile.id, ...DEFAULT_AUTO_BACKUP };
    const next: AutoBackupConfig = { ...base, target: 'cloud', dirName: '' };
    delete next.dir;
    delete next.lastError;
    await profilesDb.autoBackups.put(next);
    await backupNow(session);
  }

  async function turnOff() {
    if (!session) return;
    await profilesDb.autoBackups.delete(session.profile.id);
  }

  const message =
    autoBackupMessage(outcome, toCloud ? service : null) ??
    (config?.lastError ? { text: copy.errors[config.lastError], problem: true } : null);
  const busy = running || picking;

  return (
    <>
      <h3>{copy.title}</h3>
      <p className="muted">{copy.intro}</p>
      {!config ? (
        <div className="ingest-actions">
          {cloudLinked && (
            <button
              type="button"
              className="action-primary"
              disabled={busy}
              onClick={() => void chooseCloud()}
            >
              {service && copy.chooseCloud(service)}
            </button>
          )}
          {folders && (
            <button
              type="button"
              className={cloudLinked ? 'action-secondary' : 'action-primary'}
              disabled={busy}
              onClick={() => void chooseFolder()}
            >
              {copy.choose}
            </button>
          )}
        </div>
      ) : (
        <>
          <p>
            {toCloud && service ? copy.cloudFolder(service) : copy.folder(config.dirName)}{' '}
            {folders && (
              <button
                type="button"
                className="action-secondary action-compact"
                disabled={busy}
                onClick={() => void chooseFolder()}
              >
                {toCloud ? copy.useFolder : copy.change}
              </button>
            )}{' '}
            {!toCloud && cloudLinked && (
              <button
                type="button"
                className="action-secondary action-compact"
                disabled={busy}
                onClick={() => void chooseCloud()}
              >
                {service && copy.useCloud(service)}
              </button>
            )}
          </p>
          <SelectField
            id="auto-backup-every"
            label={copy.every}
            value={config.every}
            onChange={(event) => void save({ every: event.target.value as AutoBackupEvery })}
          >
            {EVERY.map((every) => (
              <option key={every} value={every}>
                {copy.everyOptions[every]}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="auto-backup-keep"
            label={copy.keep}
            value={String(config.keep)}
            onChange={(event) => void save({ keep: Number(event.target.value) as AutoBackupKeep })}
          >
            {AUTO_BACKUP_KEEP.map((keep) => (
              <option key={keep} value={keep}>
                {copy.keepOption(keep)}
              </option>
            ))}
          </SelectField>
          {guest ? (
            <p className="muted">{copy.guestPlain}</p>
          ) : toCloud ? (
            <p className="muted">{service && copy.cloudEncrypted(service)}</p>
          ) : (
            <>
              <label className="check settings-check">
                <input
                  type="checkbox"
                  checked={config.encrypted}
                  onChange={(event) => void save({ encrypted: event.target.checked })}
                />
                {copy.encrypt}
              </label>
              <p className={config.encrypted ? 'muted' : 'ingest-problem'}>
                {config.encrypted ? copy.encryptHint : copy.plainWarning}
              </p>
            </>
          )}
          <p className="muted">
            {config.lastRunAt ? copy.lastRun(formatDateTime(config.lastRunAt)) : copy.never}
          </p>
          <button
            type="button"
            className="action-secondary"
            disabled={busy}
            onClick={() => void backupNow(session)}
          >
            {running ? copy.working : copy.now}
          </button>{' '}
          <button
            type="button"
            className="action-secondary"
            disabled={busy}
            onClick={() => void turnOff()}
          >
            {copy.turnOff}
          </button>
        </>
      )}
      {message && (
        <p className={message.problem ? 'ingest-problem' : 'doc-saved'} role="status">
          {message.text}
        </p>
      )}
    </>
  );
}
