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

/**
 * File sync state of a document (in clear, indexed):
 * - `local`: only on this device;
 * - `uploaded`: also on the sync server;
 * - `remote`: known from another device, contents still on the server;
 * - `pruned`: here, and removed from the server by the originals window;
 * - `gone`: known from another device, contents no longer on the server nor here.
 */
export type DocumentSyncState = 'local' | 'uploaded' | 'remote' | 'pruned' | 'gone';

/** Documents also carry the file contents, encrypted separately. */
export interface StoredDocumentRow extends StoredRow {
  /** Missing while `syncState` is `remote`. */
  encBytes?: EncryptedBlob;
  syncState: DocumentSyncState;
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

/** v3: optional sync of original files; `syncState` indexed, existing files are `local`. */
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  documents: 'id, invoiceId, &fileHash, updatedAt, syncState',
} as const;

/** v4: local log of AI requests (not synced). New table only. */
export const SCHEMA_V4 = {
  ...SCHEMA_V3,
  aiUsage: 'id, createdAt, updatedAt',
} as const;

/** v5: recurring expenses without an invoice and "paid" marks (page "Este mês"). New tables only. */
export const SCHEMA_V5 = {
  ...SCHEMA_V4,
  expenses: 'id, updatedAt',
  payments: 'id, updatedAt',
} as const;

/** v6: daily consumption from E-Redes exports, one per CPE (docs/eredes-xlsx.md). New table only. */
export const SCHEMA_V6 = {
  ...SCHEMA_V5,
  consumptionProfiles: 'id, supplyPointId, updatedAt',
} as const;

export const CURRENT_SCHEMA = SCHEMA_V6;

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
  aiUsage!: Table<StoredRow, string>;
  expenses!: Table<StoredRow, string>;
  payments!: Table<StoredRow, string>;
  consumptionProfiles!: Table<StoredRow, string>;

  constructor(profileId: string) {
    super(profileDbName(profileId));
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2);
    this.version(3)
      .stores(SCHEMA_V3)
      .upgrade((tx) =>
        tx
          .table('documents')
          .toCollection()
          .modify((row: StoredDocumentRow) => {
            row.syncState ??= 'local';
          }),
      );
    this.version(4).stores(SCHEMA_V4);
    this.version(5).stores(SCHEMA_V5);
    this.version(6).stores(SCHEMA_V6);
  }
}

export function profileDbName(profileId: string): string {
  return `faturometro-profile-${profileId}`;
}
