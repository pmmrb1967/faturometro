/**
 * Full export and import (PLAN.md §11, GDPR portability): a ZIP with every
 * record in clear JSON and the original files. It is meant to be readable by
 * the user and kept wherever they choose, so it is not encrypted; the AI key
 * is left out. Importing merges into the open account: a record replaces the
 * local one only when it is newer.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import type { Repositories } from '../../db/repositories';
import { sha256Hex } from '../../lib/crypto';
import { SYNCED_TABLES, type SyncedTable } from '../../sync/engine';

export const BACKUP_FORMAT = 'faturometro-backup';
export const BACKUP_VERSION = 1;
const DATA_FILE = 'faturometro.json';
const FILES_DIR = 'originais/';
/** Large enough for years of invoices; stops a wrong or hostile file from filling memory. */
const MAX_UNZIPPED_BYTES = 500_000_000;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

const recordSchema = z.looseObject({
  id: z.string().min(1).max(200),
  updatedAt: z.string().min(1).max(40),
  deletedAt: z.string().max(40).optional(),
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  tables: z.partialRecord(z.enum(SYNCED_TABLES), z.array(recordSchema)),
  documents: z
    .array(
      z.object({
        fileHash: z.string().regex(/^[0-9a-f]{64}$/),
        mime: z.string().max(100),
        path: z.string().startsWith(FILES_DIR).max(200),
      }),
    )
    .default([]),
});

export type BackupData = z.infer<typeof backupSchema>;

export class BackupError extends Error {
  readonly code: 'not_a_backup' | 'too_large';
  constructor(code: BackupError['code']) {
    super(code);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface ExportResult {
  zip: Uint8Array;
  records: number;
  files: number;
}

export async function exportBackup(repos: Repositories): Promise<ExportResult> {
  const tables: Partial<Record<SyncedTable, unknown[]>> = {};
  let records = 0;
  for (const table of SYNCED_TABLES) {
    let rows: { id: string }[] = await repos[table].list();
    if (table === 'settings') {
      // The AI key never leaves the app in clear.
      rows = rows.map((row) => {
        const copy: Record<string, unknown> = { ...row };
        delete copy.aiApiKey;
        return copy as { id: string };
      });
    }
    tables[table] = rows;
    records += rows.length;
  }

  const zip: Zippable = {};
  const documents: BackupData['documents'] = [];
  const hashes = new Set((await repos.invoices.list()).map((invoice) => invoice.fileHash));
  for (const fileHash of hashes) {
    const file = await repos.documents.getByFileHash(fileHash);
    if (!file) continue;
    const path = `${FILES_DIR}${fileHash.slice(0, 16)}.${EXTENSIONS[file.mime] ?? 'bin'}`;
    zip[path] = [file.bytes, { level: 0 }]; // PDFs and photos are already compressed
    documents.push({ fileHash, mime: file.mime, path });
  }

  const data = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    documents,
  };
  zip[DATA_FILE] = strToU8(JSON.stringify(data, null, 2));
  return { zip: zipSync(zip, { level: 6 }), records, files: documents.length };
}

export interface ImportResult {
  added: number;
  skipped: number;
  files: number;
}

export async function importBackup(repos: Repositories, bytes: Uint8Array): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  let total = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new BackupError('too_large');
        return file.name === DATA_FILE || file.name.startsWith(FILES_DIR);
      },
    });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('not_a_backup');
  }
  const raw = entries[DATA_FILE];
  if (!raw) throw new BackupError('not_a_backup');
  let parsed: BackupData;
  try {
    parsed = backupSchema.parse(JSON.parse(strFromU8(raw)));
  } catch {
    throw new BackupError('not_a_backup');
  }

  const result: ImportResult = { added: 0, skipped: 0, files: 0 };
  for (const table of SYNCED_TABLES) {
    for (const record of parsed.tables[table] ?? []) {
      // Validated above for the sync fields; the rest is the app's own format.
      const written = await (
        repos[table] as unknown as { restore(record: unknown): Promise<boolean> }
      ).restore(record);
      if (written) result.added++;
      else result.skipped++;
    }
  }
  for (const document of parsed.documents) {
    const fileBytes = entries[document.path];
    // The hash is the file's identity: a modified file is not imported.
    if (!fileBytes || (await sha256Hex(new Uint8Array(fileBytes))) !== document.fileHash) continue;
    if (await repos.documents.stateOf(document.fileHash)) continue;
    await repos.documents.put({
      fileHash: document.fileHash,
      mime: document.mime,
      bytes: new Uint8Array(fileBytes),
    });
    result.files++;
  }
  return result;
}

export function backupFileName(date = new Date()): string {
  return `faturometro-${date.toISOString().slice(0, 10)}.zip`;
}
