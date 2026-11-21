/**
 * Sync engine: push local changes (encrypted rows as stored, without the
 * clear index fields), then pull remote changes and apply them when newer
 * (last write wins). Indexes are rebuilt locally after decrypting.
 */
import type { PendingPush } from '../db/pending-push';
import type { Repositories } from '../db/repositories';
import type { OutgoingRecord, RemoteRecord, SyncApi } from './api';

/** Everything except original files (documents), which sync separately (optional). */
export const SYNCED_TABLES = [
  'providers',
  'contracts',
  'invoices',
  'invoiceLines',
  'readings',
  'alerts',
  'fieldCorrections',
  'settings',
  'expenses',
  'payments',
  'consumptionProfiles',
  'transactions',
  'incomes',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

const BATCH = 500;
/** Keeps each push well under the server limit (one SQL parameter of at most 2 MB). */
const BATCH_BYTES = 1_500_000;

export interface SyncState {
  lastPulledSeq: number;
  lastPushedAt: string;
}

export interface SyncResult extends SyncState {
  pushed: number;
  received: number;
  /** Records that could not be applied (e.g. the same invoice imported on two devices). */
  conflicts: number;
  /** The server account is an administrator (own limits). */
  admin: boolean;
  /** Administrators: layout contributions waiting to be pulled. */
  contributions?: number;
  /** The account now syncs through the user's own cloud (set by another device). */
  movedTo?: 'cloud';
}

/** Splits records into pushes limited by count and by size. */
export function batches(records: OutgoingRecord[]): OutgoingRecord[][] {
  const result: OutgoingRecord[][] = [];
  let current: OutgoingRecord[] = [];
  let size = 0;
  for (const record of records) {
    const length = JSON.stringify(record).length;
    if (current.length > 0 && (current.length >= BATCH || size + length > BATCH_BYTES)) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(record);
    size += length;
  }
  if (current.length > 0) result.push(current);
  return result;
}

function isSyncedTable(table: string): table is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(table);
}

/** A record received from another device, by the server or by the cloud. */
export type IncomingRecord = Omit<RemoteRecord, 'seq'>;

/** What to send: changed since the cursor, plus the queue of records restored from a backup. */
export async function collectOutgoing(
  repos: Repositories,
  lastPushedAt: string,
): Promise<{ records: OutgoingRecord[]; pending: PendingPush[] }> {
  const records: OutgoingRecord[] = [];
  for (const table of SYNCED_TABLES) {
    for (const row of await repos[table].changedSince(lastPushedAt)) {
      records.push({ table, ...row });
    }
  }
  // Restored from a backup: older than the cursor, so `changedSince` does not see them.
  const pending = await repos.pendingPush.list();
  const listed = new Set(records.map(({ table, id }) => `${table}:${id}`));
  for (const { table, id } of pending) {
    if (!isSyncedTable(table) || listed.has(`${table}:${id}`)) continue;
    const row = await repos[table].encryptedRow(id);
    if (row) records.push({ table, ...row });
  }
  return { records, pending };
}

/** Applies records from another device when newer (last write wins). */
export async function applyIncoming(
  repos: Repositories,
  records: readonly IncomingRecord[],
): Promise<{ received: number; conflicts: number }> {
  let received = 0;
  let conflicts = 0;
  for (const remote of records) {
    if (remote.table === 'documents') {
      // Original files: only the metadata here; contents come with the file sync.
      if (remote.deletedAt) continue;
      try {
        if (await repos.documents.applyRemote(remote.enc, remote.updatedAt)) received++;
      } catch {
        // Cannot be opened with this key: the others still apply.
        conflicts++;
      }
      continue;
    }
    if (!isSyncedTable(remote.table)) continue;
    const repo = repos[remote.table];
    const local = await repo.updatedAtOf(remote.id);
    if (local !== undefined && local >= remote.updatedAt) continue;
    try {
      await repo.applyRemote(remote.enc);
      received++;
    } catch {
      conflicts++;
    }
  }
  return { received, conflicts };
}

export async function syncNow(
  repos: Repositories,
  api: SyncApi,
  token: string,
  state: SyncState,
): Promise<SyncResult> {
  // Push.
  const { records: outgoing, pending } = await collectOutgoing(repos, state.lastPushedAt);
  for (const batch of batches(outgoing)) await api.push(token, batch);
  await repos.pendingPush.remove(pending);
  const lastPushedAt = outgoing.reduce(
    (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
    state.lastPushedAt,
  );

  // Pull.
  let since = state.lastPulledSeq;
  let received = 0;
  let conflicts = 0;
  let admin: boolean; // set by the first page (the loop runs at least once)
  let contributions: number | undefined;
  let movedTo: 'cloud' | undefined;
  for (;;) {
    const page = await api.pull(token, since);
    admin = page.admin;
    contributions = page.contributions;
    movedTo = page.movedTo;
    const applied = await applyIncoming(repos, page.records);
    received += applied.received;
    conflicts += applied.conflicts;
    since = page.latest;
    if (!page.more) break;
  }

  return {
    lastPulledSeq: since,
    lastPushedAt,
    pushed: outgoing.length,
    received,
    conflicts,
    admin,
    ...(contributions !== undefined ? { contributions } : {}),
    ...(movedTo ? { movedTo } : {}),
  };
}
