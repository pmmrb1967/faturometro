/**
 * Optional sync of original files (PDF, photos). The contents go to the
 * server exactly as stored here (AES-GCM ciphertext, base64), in chunks; an
 * encrypted record tells the other devices where to find them.
 */
import type { RemoteDocumentMeta } from '../db/documents';
import type { Repositories } from '../db/repositories';
import { decryptBytes } from '../lib/crypto';
import { SyncHttpError, type SyncApi } from './api';

/** Base64 characters per chunk (multiple of 4; the server accepts up to 1 000 000). */
export const CHUNK_LENGTH = 900_000;
const STORAGE_FULL = 507;

export interface FileSyncResult {
  uploaded: number;
  downloaded: number;
  /** Removed from the server by the originals window (still here). */
  pruned: number;
  /** The server has no room left (account quota or total). */
  storageFull: boolean;
}

export function chunk(data: string, length = CHUNK_LENGTH): string[] {
  const parts: string[] = [];
  for (let start = 0; start < data.length; start += length) {
    parts.push(data.slice(start, start + length));
  }
  return parts.length > 0 ? parts : [''];
}

/** Uploads the files only on this device, then downloads those only on the server. */
export async function syncFiles(
  repos: Repositories,
  api: SyncApi,
  token: string,
  key: CryptoKey,
  now: Date = new Date(),
): Promise<FileSyncResult> {
  const result: FileSyncResult = { uploaded: 0, downloaded: 0, pruned: 0, storageFull: false };

  for (const id of await repos.documents.localOnlyIds()) {
    const upload = await repos.documents.pendingUpload(id);
    if (!upload) continue;
    const parts = chunk(upload.encBytes.data);
    try {
      for (const [n, part] of parts.entries()) {
        await api.putChunk(token, id, n, parts.length, part);
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === STORAGE_FULL) {
        result.storageFull = true;
        break;
      }
      throw error;
    }
    // Only now can other devices learn about it.
    const record = await repos.documents.remoteRecord(upload, parts.length);
    await api.push(token, [{ table: 'documents', ...record }]);
    await repos.documents.markUploaded(id);
    result.uploaded++;
  }

  for (const meta of await repos.documents.remoteOnly()) {
    if (await download(repos, api, token, key, meta)) result.downloaded++;
  }

  // Runs after the downloads: an original that could not be downloaded is not a candidate.
  const { keepMonths } = await api.fileUsage(token);
  if (keepMonths !== null) {
    result.pruned = await pruneOld(repos, api, token, monthsBefore(now, keepMonths));
  }
  return result;
}

/** `YYYY-MM-DD`, `months` calendar months before `date` (UTC). */
export function monthsBefore(date: Date, months: number): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * Originals window: removes from the server the originals whose newest
 * invoice is older than the cutoff. Only documents whose contents are here
 * are candidates, so nothing is lost; originals without invoices stay.
 */
async function pruneOld(
  repos: Repositories,
  api: SyncApi,
  token: string,
  cutoff: string,
): Promise<number> {
  let pruned = 0;
  for (const { id, fileHash } of await repos.documents.onServerHere()) {
    const invoices = await repos.invoices.findBy('fileHash', fileHash);
    if (invoices.length === 0) continue;
    const newest = invoices.reduce(
      (latest, invoice) => (invoice.issueDate > latest ? invoice.issueDate : latest),
      '',
    );
    if (newest >= cutoff) continue;
    const record = await repos.documents.prunedRecord(id);
    await api.deleteFile(token, id);
    await api.push(token, [{ table: 'documents', ...record }]);
    await repos.documents.markPruned(id);
    pruned++;
  }
  return pruned;
}

/** Downloads one file's contents; false if they are no longer on the server. */
export async function download(
  repos: Repositories,
  api: SyncApi,
  token: string,
  key: CryptoKey,
  meta: RemoteDocumentMeta,
): Promise<boolean> {
  const parts: string[] = [];
  try {
    for (let n = 0; n < meta.chunks; n++) parts.push(await api.getChunk(token, meta.id, n));
  } catch (error) {
    if (error instanceof SyncHttpError && error.status === 404) return false;
    throw error;
  }
  const data = parts.join('');
  // Check it decrypts (authenticated encryption) before keeping it.
  await decryptBytes(key, { iv: meta.bytesIv, data });
  await repos.documents.storeDownloaded(meta, data);
  return true;
}
