/** A cloud drive in memory: for tests, and for trying the cloud sync without an account. */
import {
  CloudError,
  type CloudDrive,
  type CloudEntry,
  type CloudFile,
  type CloudErrorCode,
  type CloudWriteOptions,
} from './drive';

type Operation = 'read' | 'write' | 'list' | 'remove';

export class MemoryDrive implements CloudDrive {
  readonly files = new Map<string, { bytes: Uint8Array; etag: string }>();
  private version = 0;
  private failures: { code: CloudErrorCode; operation?: Operation }[] = [];

  /** The next call (of this kind, or of any kind) fails with this code. */
  failNext(code: CloudErrorCode, operation?: Operation): void {
    this.failures.push({ code, ...(operation ? { operation } : {}) });
  }

  private check(operation: Operation): void {
    const index = this.failures.findIndex(
      (failure) => !failure.operation || failure.operation === operation,
    );
    if (index < 0) return;
    const [failure] = this.failures.splice(index, 1);
    if (failure) throw new CloudError(failure.code);
  }

  async read(path: string): Promise<CloudFile | null> {
    this.check('read');
    const file = this.files.get(path);
    return file ? { bytes: new Uint8Array(file.bytes), etag: file.etag } : null;
  }

  async write(
    path: string,
    bytes: Uint8Array,
    options: CloudWriteOptions = {},
  ): Promise<{ etag: string }> {
    this.check('write');
    const current = this.files.get(path);
    if (options.ifMatch !== undefined && current?.etag !== options.ifMatch) {
      throw new CloudError('conflict');
    }
    if (options.ifNoneMatch === '*' && current) throw new CloudError('conflict');
    const etag = `v${++this.version}`;
    this.files.set(path, { bytes: new Uint8Array(bytes), etag });
    return { etag };
  }

  async list(folder: string): Promise<CloudEntry[]> {
    this.check('list');
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    const entries: CloudEntry[] = [];
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length);
      if (name.includes('/')) continue;
      entries.push({ name, size: file.bytes.length, etag: file.etag });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(path: string): Promise<void> {
    this.check('remove');
    this.files.delete(path);
  }

  async account(): Promise<{ label: string }> {
    return { label: 'Memória' };
  }
}
