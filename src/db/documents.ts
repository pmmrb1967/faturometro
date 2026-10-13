import type { Table } from 'dexie';
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from '../lib/crypto';
import type { StoredDocumentRow } from './schema';

export interface DocumentFile {
  fileHash: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Original files (PDF, photo), encrypted; one per file hash, shared by its invoices. */
export class DocumentStore {
  readonly indexed = ['fileHash'] as const;
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
    await this.table.put({
      id,
      updatedAt: addedAt,
      fileHash: file.fileHash,
      enc: await encryptJson(this.key, { id, fileHash: file.fileHash, mime: file.mime, addedAt }),
      encBytes: await encryptBytes(this.key, file.bytes),
    });
    return id;
  }

  async getByFileHash(fileHash: string): Promise<DocumentFile | undefined> {
    const row = await this.table.where('fileHash').equals(fileHash).first();
    if (!row || row.deletedAt) return undefined;
    const meta = (await decryptJson(this.key, row.enc)) as { mime: string };
    return { fileHash, mime: meta.mime, bytes: await decryptBytes(this.key, row.encBytes) };
  }
}
