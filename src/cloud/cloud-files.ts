/**
 * Original files (PDF, photos) in the cloud folder: `originais/<documentId>.bin`
 * holds the contents as stored here, already encrypted with the master key.
 * The record telling other devices about a file goes in a change file, sent
 * only after the contents are in the cloud.
 */
import type { Repositories } from '../db/repositories';
import { decryptBytes, fromBase64, toBase64 } from '../lib/crypto';
import type { OutgoingRecord } from '../sync/api';
import { CloudError, type CloudDrive } from './drive';

export const ORIGINALS_FOLDER = 'originais';
const originalPath = (id: string) => `${ORIGINALS_FOLDER}/${id}.bin`;

export interface OriginalsUpload {
  /** Records to send in this sync's change file. */
  records: OutgoingRecord[];
  /** The cloud is full: the rest stays on this device and is tried again later. */
  quotaFull: boolean;
  /** Once the records are sent: these originals count as in the cloud. */
  confirm(): Promise<void>;
}

export async function uploadOriginals(
  repos: Repositories,
  drive: CloudDrive,
): Promise<OriginalsUpload> {
  const records: OutgoingRecord[] = [];
  const sent: string[] = [];
  let quotaFull = false;
  for (const id of await repos.documents.localOnlyIds()) {
    const upload = await repos.documents.pendingUpload(id);
    if (!upload) continue;
    try {
      await drive.write(originalPath(id), fromBase64(upload.encBytes.data));
    } catch (error) {
      if (error instanceof CloudError && error.code === 'quota_full') {
        quotaFull = true;
        break;
      }
      throw error;
    }
    records.push({ table: 'documents', ...(await repos.documents.remoteRecord(upload, 1)) });
    sent.push(id);
  }
  return {
    records,
    quotaFull,
    confirm: async () => {
      for (const id of sent) await repos.documents.markUploaded(id);
    },
  };
}

/** Brings here the originals whose contents are only in the cloud. */
export async function downloadOriginals(
  repos: Repositories,
  drive: CloudDrive,
  key: CryptoKey,
): Promise<{ downloaded: number }> {
  let downloaded = 0;
  for (const meta of await repos.documents.remoteOnly()) {
    const file = await drive.read(originalPath(meta.id));
    if (!file) continue;
    const data = toBase64(file.bytes);
    try {
      // Refuses contents changed in the cloud (authenticated encryption).
      await decryptBytes(key, { iv: meta.bytesIv, data });
    } catch {
      continue;
    }
    await repos.documents.storeDownloaded(meta, data);
    downloaded++;
  }
  return { downloaded };
}
