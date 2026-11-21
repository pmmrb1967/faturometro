/**
 * Sync through a cloud folder, without a server to number the changes. Each
 * device writes only its own files, so two devices never write the same file:
 *
 *   alteracoes/<deviceId>-<n>.json       changes n of that device (encrypted records)
 *   alteracoes/<deviceId>-base-<n>.json  every record that device had at change n
 *
 * Other devices read them in order from a cursor per device. When a device has
 * many change files it writes a base and removes the files it covers; a device
 * whose cursor is before those reads the base instead. Records are applied by
 * last write wins, so reading one twice does no harm.
 */
import { z } from 'zod';
import type { PendingPush } from '../db/pending-push';
import type { Repositories } from '../db/repositories';
import type { OutgoingRecord } from '../sync/api';
import { applyIncoming, batches, collectOutgoing, SYNCED_TABLES } from '../sync/engine';
import { CloudError, readJson, writeJson, type CloudDrive } from './drive';

export const CHANGES_FOLDER = 'alteracoes';
/** A device compacts its change files once it has more than this many. */
export const COMPACT_AFTER = 50;

export interface CloudSyncState {
  deviceId: string;
  /** Number of this device's next change file. */
  nextSeq: number;
  /** Latest local `updatedAt` already sent. */
  lastPushedAt: string;
  /** Per other device: the last change number applied here. */
  cursors: Record<string, number>;
}

export interface CloudSyncResult {
  state: CloudSyncState;
  pushed: number;
  received: number;
  /** Records or files that could not be applied (they are tried again later). */
  conflicts: number;
}

export interface CloudSyncOptions {
  /** More records to send now (original files' metadata). */
  extraOutgoing?: readonly OutgoingRecord[];
  /** More records a base must hold (original files' metadata), as they stand now. */
  baseExtras?: () => Promise<OutgoingRecord[]>;
  /**
   * Keeps the state right after the send, before anything else can fail: the files are
   * written, so their numbers are used. Restored records leave the queue only after it.
   */
  onPushed?: (state: CloudSyncState) => Promise<void>;
}

export function bootstrapState(deviceId: string): CloudSyncState {
  return { deviceId, nextSeq: 1, lastPushedAt: '', cursors: {} };
}

const recordSchema = z.object({
  id: z.string().min(1).max(200),
  table: z.string().min(1).max(50),
  updatedAt: z.string().min(1).max(40),
  deletedAt: z.string().max(40).optional(),
  enc: z.object({ iv: z.string().max(100), data: z.string() }),
});

const fileSchema = z.object({
  format: z.enum(['faturometro-changes', 'faturometro-base']),
  version: z.literal(1),
  device: z.string(),
  seq: z.number().int().positive(),
  records: z.array(recordSchema),
});

const pad = (n: number) => String(n).padStart(8, '0');
const changePath = (device: string, n: number) => `${CHANGES_FOLDER}/${device}-${pad(n)}.json`;
const basePath = (device: string, n: number) => `${CHANGES_FOLDER}/${device}-base-${pad(n)}.json`;
const NAME = /^([0-9a-f-]{36})-(base-)?(\d{8})\.json$/;

interface DeviceFiles {
  changes: number[];
  bases: number[];
}

function byDevice(names: readonly string[]): Map<string, DeviceFiles> {
  const devices = new Map<string, DeviceFiles>();
  for (const name of names) {
    const match = NAME.exec(name);
    if (!match) continue;
    const [, device = '', base, number = '0'] = match;
    const files = devices.get(device) ?? { changes: [], bases: [] };
    (base ? files.bases : files.changes).push(Number(number));
    devices.set(device, files);
  }
  for (const files of devices.values()) {
    files.changes.sort((a, b) => a - b);
    files.bases.sort((a, b) => a - b);
  }
  return devices;
}

async function push(
  repos: Repositories,
  drive: CloudDrive,
  state: CloudSyncState,
  extra: readonly OutgoingRecord[],
): Promise<{ state: CloudSyncState; pushed: number; pending: PendingPush[] }> {
  const { records, pending } = await collectOutgoing(repos, state.lastPushedAt);
  const outgoing = [...records, ...extra];
  if (outgoing.length === 0) return { state, pushed: 0, pending: [] };
  let seq = state.nextSeq;
  for (const batch of batches(outgoing)) {
    await writeJson(drive, changePath(state.deviceId, seq), {
      format: 'faturometro-changes',
      version: 1,
      device: state.deviceId,
      seq,
      records: batch,
    });
    seq++;
  }
  const lastPushedAt = records.reduce(
    (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
    state.lastPushedAt,
  );
  return {
    state: { ...state, nextSeq: seq, lastPushedAt },
    pushed: outgoing.length,
    pending: [...pending],
  };
}

async function pull(
  repos: Repositories,
  drive: CloudDrive,
  state: CloudSyncState,
  devices: Map<string, DeviceFiles>,
): Promise<{ cursors: Record<string, number>; received: number; conflicts: number }> {
  const cursors = { ...state.cursors };
  let received = 0;
  let conflicts = 0;
  for (const [device, files] of devices) {
    if (device === state.deviceId) continue;
    let cursor = cursors[device] ?? 0;
    const next = files.changes.find((n) => n > cursor);
    const latestBase = files.bases.at(-1);
    // The files after the cursor were compacted away: start from the base.
    const plan: { path: string; seq: number }[] = [];
    if (latestBase !== undefined && latestBase > cursor && next !== cursor + 1) {
      plan.push({ path: basePath(device, latestBase), seq: latestBase });
      cursor = latestBase;
    }
    for (const n of files.changes) {
      if (n > cursor) plan.push({ path: changePath(device, n), seq: n });
    }
    for (const step of plan) {
      let file: z.infer<typeof fileSchema> | null;
      try {
        file = await readJson(drive, step.path, fileSchema);
      } catch (error) {
        if (error instanceof CloudError && error.code !== 'unexpected') throw error;
        file = null;
      }
      if (!file) {
        // Damaged or gone: stop here for this device and try again on the next sync.
        conflicts++;
        break;
      }
      const applied = await applyIncoming(repos, file.records);
      received += applied.received;
      conflicts += applied.conflicts;
      cursors[device] = step.seq;
    }
  }
  return { cursors, received, conflicts };
}

async function compact(
  repos: Repositories,
  drive: CloudDrive,
  state: CloudSyncState,
  own: DeviceFiles,
  baseExtras?: () => Promise<OutgoingRecord[]>,
): Promise<void> {
  const last = state.nextSeq - 1;
  const records: OutgoingRecord[] = [];
  for (const table of SYNCED_TABLES) {
    for (const row of await repos[table].changedSince('')) records.push({ table, ...row });
  }
  if (baseExtras) records.push(...(await baseExtras()));
  await writeJson(drive, basePath(state.deviceId, last), {
    format: 'faturometro-base',
    version: 1,
    device: state.deviceId,
    seq: last,
    records,
  });
  // Only once the base is there: a reader never finds neither.
  for (const n of own.changes) {
    if (n <= last) await drive.remove(changePath(state.deviceId, n));
  }
  for (const n of own.bases) {
    if (n < last) await drive.remove(basePath(state.deviceId, n));
  }
}

export async function cloudSync(
  repos: Repositories,
  drive: CloudDrive,
  state: CloudSyncState,
  options: CloudSyncOptions = {},
): Promise<CloudSyncResult> {
  const devices = byDevice((await drive.list(CHANGES_FOLDER)).map((entry) => entry.name));
  // Numbers already in the folder are never written again, even when the state that
  // counted them was lost (a sync cut short, an older copy of the state): another device
  // may have read them.
  const own = devices.get(state.deviceId) ?? { changes: [], bases: [] };
  const highest = Math.max(0, ...own.changes, ...own.bases);
  const start = { ...state, nextSeq: Math.max(state.nextSeq, highest + 1) };

  const pushed = await push(repos, drive, start, options.extraOutgoing ?? []);
  if (pushed.pushed > 0) {
    await options.onPushed?.(pushed.state);
    await repos.pendingPush.remove(pushed.pending);
    for (let n = start.nextSeq; n < pushed.state.nextSeq; n++) own.changes.push(n);
  }
  const pulled = await pull(repos, drive, pushed.state, devices);
  const next: CloudSyncState = { ...pushed.state, cursors: pulled.cursors };

  if (own.changes.length > COMPACT_AFTER) {
    await compact(repos, drive, next, own, options.baseExtras);
  }
  return {
    state: next,
    pushed: pushed.pushed,
    received: pulled.received,
    conflicts: pulled.conflicts,
  };
}
