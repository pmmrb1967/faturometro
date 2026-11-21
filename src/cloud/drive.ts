/**
 * A cloud drive as the app uses it: a folder of its own in the user's cloud
 * (OneDrive first; Google Drive and Dropbox would be other implementations).
 * Paths are relative to that folder, with "/" between folders. Everything
 * written here is already encrypted on the device, except `conta.json`'s email.
 */
import type { z } from 'zod';

export interface CloudEntry {
  name: string;
  size: number;
  etag: string;
}

export interface CloudFile {
  bytes: Uint8Array;
  etag: string;
}

export interface CloudWriteOptions {
  /** Write only if the file is still this version. */
  ifMatch?: string;
  /** Write only if the file does not exist yet. */
  ifNoneMatch?: '*';
}

export interface CloudDrive {
  /** Null when the file does not exist. */
  read(path: string): Promise<CloudFile | null>;
  write(path: string, bytes: Uint8Array, options?: CloudWriteOptions): Promise<{ etag: string }>;
  /** Files directly in the folder (not in subfolders); empty when the folder does not exist. */
  list(folder: string): Promise<CloudEntry[]>;
  /** Does not fail when the file is already gone. */
  remove(path: string): Promise<void>;
  /** Only to show which account is linked. */
  account(): Promise<{ label: string }>;
}

export type CloudErrorCode =
  'needs_reconnect' | 'quota_full' | 'throttled' | 'conflict' | 'offline' | 'unexpected';

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: CloudErrorCode, retryAfterSeconds?: number) {
    super(`Cloud drive: ${code}`);
    this.name = 'CloudError';
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function writeJson(
  drive: CloudDrive,
  path: string,
  value: unknown,
  options?: CloudWriteOptions,
): Promise<{ etag: string }> {
  return drive.write(path, encoder.encode(JSON.stringify(value)), options);
}

/** Null when missing; a file that is not this JSON is `unexpected`. */
export async function readJson<T>(
  drive: CloudDrive,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  return (await readJsonWithEtag(drive, path, schema))?.value ?? null;
}

/** With the version read, to write it back only if nobody changed it meanwhile. */
export async function readJsonWithEtag<T>(
  drive: CloudDrive,
  path: string,
  schema: z.ZodType<T>,
): Promise<{ value: T; etag: string } | null> {
  const file = await drive.read(path);
  if (file === null) return null;
  try {
    return { value: schema.parse(JSON.parse(decoder.decode(file.bytes))), etag: file.etag };
  } catch {
    throw new CloudError('unexpected');
  }
}
