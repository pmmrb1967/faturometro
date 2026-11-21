import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { generateMasterKey } from '../lib/crypto';
import { MemoryDrive } from './memory-drive';
import { bootstrapState, cloudSync, COMPACT_AFTER, type CloudSyncState } from './sync-protocol';

interface Device {
  repos: Repositories;
  state: CloudSyncState;
}

let key: CryptoKey;
let drive: MemoryDrive;

function device(): Device {
  return {
    repos: createRepositories(new ProfileDb(crypto.randomUUID()), key),
    state: bootstrapState(crypto.randomUUID()),
  };
}

async function sync(target: Device) {
  const result = await cloudSync(target.repos, drive, target.state);
  target.state = result.state;
  return result;
}

function provider(id: string, name: string) {
  return { id, nif: '500000000', name, sectors: ['telecom'] } as never;
}

const names = async (target: Device) =>
  (await target.repos.providers.list()).map((row) => row.name).sort();

beforeEach(async () => {
  key = await generateMasterKey();
  drive = new MemoryDrive();
});

describe('cloudSync', () => {
  it('brings one device’s changes to another', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    expect((await sync(a)).pushed).toBe(1);
    expect((await sync(b)).received).toBe(1);
    expect(await names(b)).toEqual(['NOS']);
  });

  it('loses nothing when two devices sync at the same time, and a third sees both', async () => {
    const a = device();
    const b = device();
    const c = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    await b.repos.providers.put(provider('p2', 'Repsol'));
    await sync(a);
    await sync(b);
    await sync(a);
    await sync(c);
    expect(await names(a)).toEqual(['NOS', 'Repsol']);
    expect(await names(b)).toEqual(['NOS', 'Repsol']);
    expect(await names(c)).toEqual(['NOS', 'Repsol']);
  });

  it('keeps the most recent version of a record changed on two devices', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p1', 'Antigo'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await b.repos.providers.put(provider('p1', 'Recente'));
    await sync(a);
    await sync(b);
    await sync(a);
    expect(await names(a)).toEqual(['Recente']);
    expect(await names(b)).toEqual(['Recente']);
  });

  it('carries deletions', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    await sync(a);
    await sync(b);
    await a.repos.providers.remove('p1');
    await sync(a);
    await sync(b);
    expect(await names(b)).toEqual([]);
  });

  it('compacts its own files, and a device far behind reads the base', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p0', 'Primeiro'));
    await sync(a);
    await sync(b);
    for (let n = 1; n <= COMPACT_AFTER + 1; n++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await a.repos.providers.put(provider(`p${n}`, `F${String(n).padStart(2, '0')}`));
      await sync(a);
    }
    const files = [...drive.files.keys()].filter((path) => path.includes(a.state.deviceId));
    expect(files.some((path) => path.includes('-base-'))).toBe(true);
    expect(files.length).toBeLessThan(COMPACT_AFTER);
    await sync(b);
    expect(await names(b)).toEqual(await names(a));
  }, 30_000);

  it('moves nothing on when sending fails, and sends it all on the next sync', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    const before = a.state;
    drive.failNext('quota_full');
    await expect(cloudSync(a.repos, drive, a.state)).rejects.toMatchObject({ code: 'quota_full' });
    expect(a.state).toEqual(before);
    await sync(a);
    expect(a.state.nextSeq).toBe(before.nextSeq + 1);
    await sync(b);
    expect(await names(b)).toEqual(['NOS']);
  });

  it('skips a damaged file without losing the others, and tries it again later', async () => {
    const a = device();
    const b = device();
    const c = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    await b.repos.providers.put(provider('p2', 'Repsol'));
    await sync(a);
    await sync(b);
    const damaged = [...drive.files.keys()].find((path) => path.includes(b.state.deviceId));
    if (!damaged) throw new Error('no file');
    drive.files.set(damaged, { bytes: new TextEncoder().encode('{ estragado'), etag: 'x' });
    const result = await sync(c);
    expect(result.conflicts).toBe(1);
    expect(await names(c)).toEqual(['NOS']);
    expect(c.state.cursors[b.state.deviceId] ?? 0).toBe(0);
  });

  it('never reuses a change number when the state after a send was lost', async () => {
    const a = device();
    const b = device();
    const c = device();
    await b.repos.providers.put(provider('p2', 'Repsol'));
    await sync(b);
    await a.repos.providers.put(provider('p1', 'NOS'));
    const lost = a.state;
    // The send works, then reading b's file fails: the new state is never kept.
    drive.failNext('throttled', 'read');
    await expect(cloudSync(a.repos, drive, a.state)).rejects.toMatchObject({ code: 'throttled' });
    expect(a.state).toEqual(lost);
    await sync(c);
    expect(await names(c)).toEqual(['NOS', 'Repsol']);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await a.repos.providers.put(provider('p3', 'Vodafone'));
    await sync(a);
    await sync(c);
    expect(await names(c)).toEqual(['NOS', 'Repsol', 'Vodafone']);
  });

  it('hands over the state after sending, before reading the others', async () => {
    const a = device();
    const b = device();
    await b.repos.providers.put(provider('p2', 'Repsol'));
    await sync(b);
    await a.repos.providers.put(provider('p1', 'NOS'));
    const saved: CloudSyncState[] = [];
    drive.failNext('offline', 'read');
    await expect(
      cloudSync(a.repos, drive, a.state, {
        onPushed: (state) => {
          saved.push(state);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ code: 'offline' });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.nextSeq).toBe(2);
    expect(saved[0]?.lastPushedAt).not.toBe('');
  });

  it('counts an original’s record it cannot open as a conflict, and reads the rest', async () => {
    const a = device();
    const b = device();
    await a.repos.providers.put(provider('p1', 'NOS'));
    await sync(a);
    const path = [...drive.files.keys()][0] ?? '';
    const file = JSON.parse(new TextDecoder().decode(drive.files.get(path)?.bytes)) as {
      records: unknown[];
    };
    file.records.unshift({
      id: 'd1',
      table: 'documents',
      updatedAt: '2026-11-21T10:00:00.000Z',
      enc: { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' },
    });
    drive.files.set(path, { bytes: new TextEncoder().encode(JSON.stringify(file)), etag: 'y' });
    const result = await sync(b);
    expect(result.conflicts).toBe(1);
    expect(await names(b)).toEqual(['NOS']);
  });

  it('sends nothing when nothing changed', async () => {
    const a = device();
    await sync(a);
    expect([...drive.files.keys()]).toEqual([]);
    expect(a.state.nextSeq).toBe(1);
  });
});
