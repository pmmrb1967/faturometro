/**
 * Sync engine: push local changes (encrypted rows as stored, without the
 * clear index fields), then pull remote changes and apply them when newer
 * (last write wins). Indexes are rebuilt locally after decrypting.
 */
import type { Repositories } from '../db/repositories';
import type { OutgoingRecord, SyncApi } from './api';

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
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

const BATCH = 500;

export interface SyncState {
  lastPulledSeq: number;
  lastPushedAt: string;
}

export interface SyncResult extends SyncState {
  pushed: number;
  received: number;
  /** Records that could not be applied (e.g. the same invoice imported on two devices). */
  conflicts: number;
}

function isSyncedTable(table: string): table is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(table);
}

export async function syncNow(
  repos: Repositories,
  api: SyncApi,
  token: string,
  state: SyncState,
): Promise<SyncResult> {
  // Push.
  const outgoing: OutgoingRecord[] = [];
  for (const table of SYNCED_TABLES) {
    for (const row of await repos[table].changedSince(state.lastPushedAt)) {
      outgoing.push({ table, ...row });
    }
  }
  for (let start = 0; start < outgoing.length; start += BATCH) {
    await api.push(token, outgoing.slice(start, start + BATCH));
  }
  const lastPushedAt = outgoing.reduce(
    (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
    state.lastPushedAt,
  );

  // Pull.
  let since = state.lastPulledSeq;
  let received = 0;
  let conflicts = 0;
  for (;;) {
    const page = await api.pull(token, since);
    for (const remote of page.records) {
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
    since = page.latest;
    if (!page.more) break;
  }

  return { lastPulledSeq: since, lastPushedAt, pushed: outgoing.length, received, conflicts };
}
