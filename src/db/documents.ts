import type { Table } from 'dexie';
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  type EncryptedBlob,
} from '../lib/crypto';
import type { DocumentSyncState, StoredDocumentRow } from './schema';

export interface DocumentFile {
  fileHash: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Encrypted metadata of a document (`enc` of the row). */
interface DocumentMeta {
  id: string;
  fileHash: string;
  mime: string;
  addedAt: string;
}

/**
 * Metadata sent to other devices (inside an encrypted record): where the
 * encrypted contents are on the server and how to read them back.
 */
export interface RemoteDocumentMeta extends DocumentMeta {
  /** IV of `encBytes`; the server keeps only `encBytes.data`, in chunks. */
  bytesIv: string;
  chunks: number;
  /** `false` once the contents left the server (originals window): only on devices. */
  onServer?: false;
}

/** A document whose contents are waiting to be uploaded. */
export interface PendingUpload {
  id: string;
  updatedAt: string;
  encBytes: EncryptedBlob;
}

/** Original files (PDF, photo), encrypted; one per file hash, shared by its invoices. */
export class DocumentStore {
  readonly indexed = ['fileHash', 'syncState'] as const;
  private readonly table: Table<StoredDocumentRow, string>;
  private readonly key: CryptoKey;

  constructor(table: Table<StoredDocumentRow, string>, key: CryptoKey) {
    this.table = table;
    this.key = key;
  }

  /** Stores the file unless it is already there; returns its id. */
  async put(file: DocumentFile): Promise<string> {
    const existing = await this.table.where('fileHash').equals(file.fileHash).first();
    if (existing && !existing.deletedAt) return existing.id;
    const id = crypto.randomUUID();
    const addedAt = new Date().toISOString();
    const meta: DocumentMeta = { id, fileHash: file.fileHash, mime: file.mime, addedAt };
    await this.table.put({
      id,
      updatedAt: addedAt,
      fileHash: file.fileHash,
      syncState: 'local',
      enc: await encryptJson(this.key, meta),
      encBytes: await encryptBytes(this.key, file.bytes),
    });
    return id;
  }

  /** The file, if its contents are on this device. */
  async getByFileHash(fileHash: string): Promise<DocumentFile | undefined> {
    const row = await this.table.where('fileHash').equals(fileHash).first();
    if (!row || row.deletedAt || !row.encBytes) return undefined;
    const meta = (await decryptJson(this.key, row.enc)) as DocumentMeta;
    return { fileHash, mime: meta.mime, bytes: await decryptBytes(this.key, row.encBytes) };
  }

  /** Where the original of an invoice is: here, only on the server, or nowhere. */
  async stateOf(fileHash: string): Promise<DocumentSyncState | undefined> {
    const row = await this.table.where('fileHash').equals(fileHash).first();
    return row && !row.deletedAt ? row.syncState : undefined;
  }

  /** Ids of documents only on this device (read one at a time: rows hold whole files). */
  async localOnlyIds(): Promise<string[]> {
    return this.table.where('syncState').equals('local').primaryKeys();
  }

  async pendingUpload(id: string): Promise<PendingUpload | undefined> {
    const row = await this.table.get(id);
    if (!row || row.deletedAt || !row.encBytes || row.syncState !== 'local') return undefined;
    return { id, updatedAt: row.updatedAt, encBytes: row.encBytes };
  }

  /** The encrypted record other devices receive once the contents are uploaded. */
  async remoteRecord(
    upload: PendingUpload,
    chunks: number,
  ): Promise<{ id: string; updatedAt: string; enc: EncryptedBlob }> {
    const row = await this.table.get(upload.id);
    if (!row) throw new Error('Document not found');
    const meta = (await decryptJson(this.key, row.enc)) as DocumentMeta;
    const remote: RemoteDocumentMeta = { ...meta, bytesIv: upload.encBytes.iv, chunks };
    return { id: upload.id, updatedAt: upload.updatedAt, enc: await encryptJson(this.key, remote) };
  }

  async markUploaded(id: string): Promise<void> {
    await this.table.update(id, { syncState: 'uploaded' });
  }

  /**
   * Documents whose contents are both here and on the server. Key-only reads
   * (two cursors over the same index): rows hold whole files.
   */
  async onServerHere(): Promise<{ id: string; fileHash: string }[]> {
    const here = new Set(await this.table.where('syncState').equals('uploaded').primaryKeys());
    const hashes = await this.table.orderBy('fileHash').keys();
    const ids = await this.table.orderBy('fileHash').primaryKeys();
    return ids.flatMap((id, i) => (here.has(id) ? [{ id, fileHash: String(hashes[i]) }] : []));
  }

  /** The record telling the other devices that the contents left the server. */
  async prunedRecord(id: string): Promise<{ id: string; updatedAt: string; enc: EncryptedBlob }> {
    const row = await this.table.get(id);
    if (!row?.encBytes) throw new Error('Document contents are not on this device');
    const meta = (await decryptJson(this.key, row.enc)) as DocumentMeta;
    const remote: RemoteDocumentMeta = {
      id: meta.id,
      fileHash: meta.fileHash,
      mime: meta.mime,
      addedAt: meta.addedAt,
      bytesIv: row.encBytes.iv,
      chunks: 0,
      onServer: false,
    };
    // Strictly newer than the upload record, or the server (last write wins) would keep that one.
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
    return { id, updatedAt, enc: await encryptJson(this.key, remote) };
  }

  async markPruned(id: string): Promise<void> {
    await this.table.update(id, { syncState: 'pruned' });
  }

  /**
   * The server account and its files are gone: what is here becomes local
   * again (sent anew if sync is turned back on); what was only there is gone.
   */
  async forgetServer(): Promise<void> {
    await this.table.where('syncState').anyOf('uploaded', 'pruned').modify({ syncState: 'local' });
    await this.table.where('syncState').equals('remote').modify({ syncState: 'gone' });
  }

  /**
   * Records a document added on another device (contents still on the
   * server). Ignored when this device already has the same file.
   */
  async applyRemote(enc: EncryptedBlob, updatedAt: string): Promise<boolean> {
    const meta = (await decryptJson(this.key, enc)) as RemoteDocumentMeta;
    if (meta.onServer === false) return this.applyPruned(meta, updatedAt);
    if (await this.table.where('fileHash').equals(meta.fileHash).count()) return false;
    if (await this.table.get(meta.id)) return false;
    await this.table.put({
      id: meta.id,
      updatedAt,
      fileHash: meta.fileHash,
      syncState: 'remote',
      enc: await encryptJson(this.key, meta),
    });
    return true;
  }

  /** The contents left the server: keep what is here, never try to download them again. */
  private async applyPruned(meta: RemoteDocumentMeta, updatedAt: string): Promise<boolean> {
    const row =
      (await this.table.get(meta.id)) ??
      (await this.table.where('fileHash').equals(meta.fileHash).first());
    if (!row) {
      await this.table.put({
        id: meta.id,
        updatedAt,
        fileHash: meta.fileHash,
        syncState: 'gone',
        enc: await encryptJson(this.key, meta),
      });
      return true;
    }
    const next =
      row.syncState === 'remote' ? 'gone' : row.syncState === 'uploaded' ? 'pruned' : undefined;
    if (!next) return false;
    await this.table.update(row.id, { syncState: next });
    return true;
  }

  /** Documents whose contents are still only on the server. */
  async remoteOnly(): Promise<RemoteDocumentMeta[]> {
    const rows = await this.table.where('syncState').equals('remote').toArray();
    return Promise.all(
      rows
        .filter((row) => !row.deletedAt)
        .map(async (row) => (await decryptJson(this.key, row.enc)) as RemoteDocumentMeta),
    );
  }

  async remoteMetaByFileHash(fileHash: string): Promise<RemoteDocumentMeta | undefined> {
    const row = await this.table.where('fileHash').equals(fileHash).first();
    if (!row || row.deletedAt || row.syncState !== 'remote') return undefined;
    return (await decryptJson(this.key, row.enc)) as RemoteDocumentMeta;
  }

  /** Stores contents downloaded from the server (still encrypted with the master key). */
  async storeDownloaded(meta: RemoteDocumentMeta, data: string): Promise<void> {
    await this.table.update(meta.id, {
      encBytes: { iv: meta.bytesIv, data },
      syncState: 'uploaded',
    });
  }
}
