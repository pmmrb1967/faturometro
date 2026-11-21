import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { generateMasterKey, sha256Hex } from '../lib/crypto';
import { downloadOriginals, ORIGINALS_FOLDER, uploadOriginals } from './cloud-files';
import { MemoryDrive } from './memory-drive';
import { bootstrapState, cloudSync, COMPACT_AFTER, type CloudSyncState } from './sync-protocol';

interface Device {
  repos: Repositories;
  state: CloudSyncState;
}

let key: CryptoKey;
let drive: MemoryDrive;
const pdf = new TextEncoder().encode('%PDF-1.7 fatura de teste');

function device(): Device {
  return {
    repos: createRepositories(new ProfileDb(crypto.randomUUID()), key),
    state: bootstrapState(crypto.randomUUID()),
  };
}

/** What the app does on each sync with originals on. */
async function syncWithFiles(target: Device) {
  const upload = await uploadOriginals(target.repos, drive);
  const result = await cloudSync(target.repos, drive, target.state, {
    extraOutgoing: upload.records,
    baseExtras: () => target.repos.documents.cloudRecords(),
  });
  target.state = result.state;
  await upload.confirm();
  const download = await downloadOriginals(target.repos, drive, key);
  return { upload, download };
}

async function addOriginal(target: Device): Promise<string> {
  const fileHash = await sha256Hex(new Uint8Array(pdf));
  await target.repos.documents.put({
    fileHash,
    mime: 'application/pdf',
    bytes: new Uint8Array(pdf),
  });
  return fileHash;
}

beforeEach(async () => {
  key = await generateMasterKey();
  drive = new MemoryDrive();
});

describe('originals in the cloud folder', () => {
  it('sends an original to another device with the same bytes', async () => {
    const a = device();
    const b = device();
    const fileHash = await addOriginal(a);
    expect((await syncWithFiles(a)).upload.records).toHaveLength(1);
    expect([...drive.files.keys()].some((path) => path.startsWith(`${ORIGINALS_FOLDER}/`))).toBe(
      true,
    );
    expect((await syncWithFiles(b)).download.downloaded).toBe(1);
    expect((await b.repos.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);
    // Sent once: the next sync uploads nothing.
    expect((await syncWithFiles(a)).upload.records).toHaveLength(0);
  });

  it('refuses contents that were tampered with', async () => {
    const a = device();
    const b = device();
    const fileHash = await addOriginal(a);
    await syncWithFiles(a);
    const path = [...drive.files.keys()].find((name) => name.startsWith(`${ORIGINALS_FOLDER}/`));
    if (!path) throw new Error('no original');
    drive.files.set(path, {
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
      etag: 'x',
    });
    const { download } = await syncWithFiles(b);
    expect(download.downloaded).toBe(0);
    expect(await b.repos.documents.getByFileHash(fileHash)).toBeUndefined();
  });

  it('keeps an original on this device when the cloud is full, and sends it later', async () => {
    const a = device();
    await addOriginal(a);
    drive.failNext('quota_full', 'write');
    const first = await uploadOriginals(a.repos, drive);
    expect(first.quotaFull).toBe(true);
    expect(first.records).toHaveLength(0);
    expect((await uploadOriginals(a.repos, drive)).records).toHaveLength(1);
  });

  it('a device far behind still learns of an original after compaction', async () => {
    const a = device();
    const b = device();
    const fileHash = await addOriginal(a);
    await syncWithFiles(a);
    for (let n = 1; n <= COMPACT_AFTER + 1; n++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await a.repos.providers.put({ id: `p${n}`, nif: '5', name: `F${n}`, sectors: [] } as never);
      await syncWithFiles(a);
    }
    await syncWithFiles(b);
    expect((await b.repos.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);
  });
});
