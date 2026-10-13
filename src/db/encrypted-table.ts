import type { IndexableType, Table } from 'dexie';
import type { SyncMeta } from '../domain/types';
import { decryptJson, encryptJson } from '../lib/crypto';
import type { StoredRow } from './schema';

type Indexable<T> = { [K in keyof T]: T[K] extends IndexableType | undefined ? K : never }[keyof T];

/**
 * Repository over one table: encrypts records on write, decrypts on read.
 * Only the listed fields are copied in clear for indexing.
 */
export class EncryptedTable<T extends SyncMeta> {
  private readonly table: Table<StoredRow, string>;
  private readonly key: CryptoKey;
  readonly indexed: readonly Exclude<keyof T, keyof SyncMeta>[];

  constructor(
    table: Table<StoredRow, string>,
    key: CryptoKey,
    indexed: readonly Exclude<keyof T, keyof SyncMeta>[],
  ) {
    this.table = table;
    this.key = key;
    this.indexed = indexed;
  }

  /** Inserts or replaces a record, stamping `updatedAt`. */
  async put(value: Omit<T, 'updatedAt'> & { updatedAt?: string }): Promise<T> {
    const record = { ...value, updatedAt: new Date().toISOString() } as T;
    const row: StoredRow = {
      id: record.id,
      updatedAt: record.updatedAt,
      enc: await encryptJson(this.key, record),
    };
    // Tombstones keep no indexed fields, so unique indexes (file hash…) are freed.
    if (record.deletedAt) row.deletedAt = record.deletedAt;
    else
      for (const field of this.indexed) {
        const fieldValue = record[field];
        if (fieldValue !== undefined) row[field as string] = fieldValue;
      }
    await this.table.put(row);
    return record;
  }

  async get(id: string): Promise<T | undefined> {
    const row = await this.table.get(id);
    if (!row || row.deletedAt) return undefined;
    return this.decrypt(row);
  }

  /** All records not deleted. */
  async list(): Promise<T[]> {
    const rows = await this.table.toArray();
    return Promise.all(rows.filter((row) => !row.deletedAt).map((row) => this.decrypt(row)));
  }

  async findBy<K extends Indexable<T> & Exclude<keyof T, keyof SyncMeta>>(
    field: K,
    value: T[K] & IndexableType,
  ): Promise<T[]> {
    const rows = await this.table
      .where(field as string)
      .equals(value)
      .toArray();
    return Promise.all(rows.filter((row) => !row.deletedAt).map((row) => this.decrypt(row)));
  }

  /** Soft delete (tombstone), so the deletion can be synced. */
  async remove(id: string): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    await this.put({ ...current, deletedAt: new Date().toISOString() });
  }

  private async decrypt(row: StoredRow): Promise<T> {
    return (await decryptJson(this.key, row.enc)) as T;
  }
}
