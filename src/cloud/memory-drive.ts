/** A cloud drive in memory: for tests, and for trying the cloud sync without an account. */
import {
  CloudError,
  type CloudDrive,
  type CloudEntry,
  type CloudErrorCode,
  type CloudWriteOptions,
} from './drive';

export class MemoryDrive implements CloudDrive {
  readonly files = new Map<string, { bytes: Uint8Array; etag: string }>();
  private version = 0;
  private failures: CloudErrorCode[] = [];

  /** The next call (of any kind) fails with this code. */
  failNext(code: CloudErrorCode): void {
    this.failures.push(code);
  }

  private check(): void {
    const code = this.failures.shift();
    if (code) throw new CloudError(code);
  }

  async read(path: string): Promise<Uint8Array | null> {
    this.check();
    const file = this.files.get(path);
    return file ? new Uint8Array(file.bytes) : null;
  }

  async write(
    path: string,
    bytes: Uint8Array,
    options: CloudWriteOptions = {},
  ): Promise<{ etag: string }> {
    this.check();
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
    this.check();
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
    this.check();
    this.files.delete(path);
  }

  async account(): Promise<{ label: string }> {
    return { label: 'Memória' };
  }
}
