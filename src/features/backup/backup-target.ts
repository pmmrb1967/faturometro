/**
 * Where the automatic backup writes: a folder on this computer (File System
 * Access, Chrome and Edge on computers) or `copias/` in the user's cloud
 * folder (any browser, once the cloud is linked).
 */
import { driveFor } from '../../cloud/cloud-run';
import type { CloudDrive } from '../../cloud/drive';
import { TEMP_SUFFIX } from '../../domain/auto-backup';
import type { AutoBackupConfig, Profile } from '../../db/profiles';
import { asBackupFolder, type BackupFolder } from './fs-access';

export const CLOUD_BACKUP_FOLDER = 'copias';

export interface BackupTarget {
  /** True when it can be written now; null when only a click can allow it. */
  ready(interactive: boolean): Promise<boolean | null>;
  list(): Promise<string[]>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The target of a saved configuration (saved before cloud backups: a folder). */
export function targetFor(config: AutoBackupConfig, profile: Profile): BackupTarget | null {
  if (config.target === 'cloud') return profile.cloud ? cloudTarget(driveFor(profile)) : null;
  return config.dir ? folderTarget(config.dir) : null;
}

export function cloudTarget(drive: CloudDrive): BackupTarget {
  const path = (name: string) => `${CLOUD_BACKUP_FOLDER}/${name}`;
  return {
    ready: () => Promise.resolve(true),
    list: async () => (await drive.list(CLOUD_BACKUP_FOLDER)).map((entry) => entry.name),
    write: async (name, bytes) => {
      // One request (or one upload session): a copy cut short never gets its final name.
      await drive.write(path(name), bytes);
    },
    remove: (name) => drive.remove(path(name)),
  };
}

interface MovableFile {
  move?: (newName: string) => Promise<void>;
}

async function writeTo(file: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await file.createWritable();
  await writable.write(new Uint8Array(bytes));
  await writable.close();
}

async function exists(folder: BackupFolder, name: string): Promise<boolean> {
  try {
    await folder.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export function folderTarget(dir: FileSystemDirectoryHandle): BackupTarget {
  const folder = asBackupFolder(dir);
  return {
    async ready(interactive) {
      const mode = { mode: 'readwrite' } as const;
      if ((await folder.queryPermission(mode)) === 'granted') return true;
      if (!interactive) return null;
      return (await folder.requestPermission(mode)) === 'granted';
    },
    async list() {
      const names: string[] = [];
      for await (const name of folder.keys()) names.push(name);
      return names;
    },
    /**
     * Writes under a temporary name the backup names never match, then renames it:
     * a write cut short (the browser closed) never looks like a backup.
     */
    async write(name, bytes) {
      const temp = `${name}${TEMP_SUFFIX}`;
      const file = (await folder.getFileHandle(temp, { create: true })) as FileSystemFileHandle &
        MovableFile;
      if (file.move) {
        try {
          await writeTo(file, bytes);
          await file.move(name);
        } catch (error) {
          await folder.removeEntry(temp).catch(() => undefined);
          throw error;
        }
        return;
      }
      // Without move() (older browsers): straight to the final name.
      await folder.removeEntry(temp).catch(() => undefined);
      const existed = await exists(folder, name);
      try {
        await writeTo(await folder.getFileHandle(name, { create: true }), bytes);
      } catch (error) {
        // Remove only what this run created: a good backup already under `name` stays.
        if (!existed) await folder.removeEntry(name).catch(() => undefined);
        throw error;
      }
    },
    remove: (name) => folder.removeEntry(name),
  };
}
