/**
 * The parts of the File System Access API that TypeScript's DOM library does not
 * declare yet (Chrome and Edge on computers only).
 */

export type FolderPermission = 'granted' | 'denied' | 'prompt';

interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}

/** A folder as the automatic backup uses it. */
export interface BackupFolder {
  readonly name: string;
  queryPermission(descriptor: PermissionDescriptor): Promise<FolderPermission>;
  requestPermission(descriptor: PermissionDescriptor): Promise<FolderPermission>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

interface DirectoryPickerWindow {
  showDirectoryPicker(options: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'documents' | 'desktop' | 'downloads';
  }): Promise<FileSystemDirectoryHandle>;
}

export function supportsFolderBackup(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** The handle as stored, with the methods the browser has but TypeScript does not know. */
export function asBackupFolder(handle: FileSystemDirectoryHandle): BackupFolder {
  return handle as unknown as BackupFolder;
}

/** Asks the user for a folder; null when they cancel. Only from a click. */
export async function pickBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
      id: 'faturometro-backup',
      mode: 'readwrite',
      startIn: 'documents',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
