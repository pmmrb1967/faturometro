import Dexie, { type Table } from 'dexie';
import type { EncryptedBlob } from '../lib/crypto';

/**
 * Stored row: id, sync metadata and the few indexed fields in clear (IDs,
 * dates, hashes, enums); the whole record is in `enc`, AES-GCM encrypted.
 */
export interface StoredRow {
  id: string;
  updatedAt: string;
  deletedAt?: string;
  enc: EncryptedBlob;
  [indexed: string]: unknown;
}

/** Documents also carry the file contents, encrypted separately. */
export interface StoredDocumentRow extends StoredRow {
  encBytes: EncryptedBlob;
}

/**
 * Indexed fields per table. Schema changes = new version + migration + test;
 * never edit an existing version.
 */
export const SCHEMA_V1 = {
  providers: 'id, nif, updatedAt',
  contracts: 'id, providerId, sector, updatedAt',
  invoices: 'id, contractId, providerId, &fileHash, &docKey, issueDate, updatedAt',
  invoiceLines: 'id, invoiceId, updatedAt',
  readings: 'id, invoiceId, contractId, dateTo, updatedAt',
  documents: 'id, invoiceId, &fileHash, updatedAt',
  alerts: 'id, contractId, kind, updatedAt',
  fieldCorrections: 'id, invoiceId, updatedAt',
  settings: 'id, updatedAt',
} as const;

/**
 * v2: one file can hold several invoices (Repsol electricity + gas, Via Verde
 * one per issuer), so invoices.fileHash is no longer unique. The file itself
 * is stored once in `documents` (unique fileHash). Index change only: no data
 * migration needed.
 */
export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  invoices: 'id, contractId, providerId, fileHash, &docKey, issueDate, updatedAt',
} as const;

export const CURRENT_SCHEMA = SCHEMA_V2;

export type TableName = keyof typeof CURRENT_SCHEMA;

export class ProfileDb extends Dexie {
  providers!: Table<StoredRow, string>;
  contracts!: Table<StoredRow, string>;
  invoices!: Table<StoredRow, string>;
  invoiceLines!: Table<StoredRow, string>;
  readings!: Table<StoredRow, string>;
  documents!: Table<StoredDocumentRow, string>;
  alerts!: Table<StoredRow, string>;
  fieldCorrections!: Table<StoredRow, string>;
  settings!: Table<StoredRow, string>;

  constructor(profileId: string) {
    super(profileDbName(profileId));
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2);
  }
}

export function profileDbName(profileId: string): string {
  return `faturometro-profile-${profileId}`;
}
