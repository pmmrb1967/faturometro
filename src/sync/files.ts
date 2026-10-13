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
): Promise<FileSyncResult> {
  const result: FileSyncResult = { uploaded: 0, downloaded: 0, storageFull: false };

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
  return result;
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
