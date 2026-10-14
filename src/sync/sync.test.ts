import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { runMaintenance } from '../../server/src/maintenance';
import { memorySql } from '../../server/test/sqlite';
import { profilesDb, type ProfileSync } from '../db/profiles';
import { createRepositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { SyncApi } from './api';
import { createAccount, unlockAccount } from '../features/auth/accounts';
import {
  changeAccountPassword,
  connectFromServer,
  disableSync,
  enableSync,
  reconnectSync,
  fetchOriginal,
  runSync,
  setFileSync,
  SyncError,
} from './account';
import type { Invoice } from '../domain/types';
import { chunk, monthsBefore } from './files';

const ITERATIONS = 1_000;
const SERVER = 'https://sync.test';

let api: SyncApi;
let serverDb: ReturnType<typeof memorySql>['db'];
let serverSql: ReturnType<typeof memorySql>['sql'];
let fileDb: ReturnType<typeof memorySql>['db'];
/** The server's request handler (lets a test wrap it, e.g. to make downloads fail). */
let serverHandle: (request: Request) => Promise<Response>;

function serverWith(options: Partial<Parameters<typeof createApp>[0]>) {
  const memory = memorySql();
  serverDb = memory.db;
  serverSql = memory.sql;
  const files = memorySql('migrations-files');
  fileDb = files.db;
  serverHandle = createApp({
    sql: memory.sql,
    files: files.sql,
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
    ...options,
  });
  api = new SyncApi(SERVER, (input, init) => serverHandle(new Request(input, init)));
}

beforeEach(async () => {
  await profilesDb.profiles.clear();
  serverWith({});
});

async function deviceA() {
  const account = await createAccount('ana@example.pt', 'palavra-passe-longa', ITERATIONS);
  const db = new ProfileDb(account.profile.id);
  const repos = createRepositories(db, account.masterKey);
  const profile = await enableSync({
    profile: account.profile,
    masterKey: account.masterKey,
    password: 'palavra-passe-longa',
    serverUrl: SERVER,
    api,
    iterations: ITERATIONS,
  });
  return { profile, masterKey: account.masterKey, repos, db };
}

/** Simulates another device: the local profile of device A does not exist there. */
async function deviceB(password = 'palavra-passe-longa') {
  await profilesDb.profiles.clear();
  const { profile, masterKey } = await connectFromServer({
    serverUrl: SERVER,
    email: 'ana@example.pt',
    password,
    api,
    localIterations: ITERATIONS,
  });
  const db = new ProfileDb(profile.id);
  return { profile, masterKey, repos: createRepositories(db, masterKey), db };
}

/** Each device has its own local profile list: keep only this device's profile while it syncs. */
async function on<T>(profile: { email: string }, run: () => Promise<T>): Promise<T> {
  await profilesDb.profiles.clear();
  await profilesDb.profiles.put(profile as never);
  return run();
}

function contract(id: string, label: string) {
  return {
    id,
    providerId: 'fornecedor-secreto-1',
    sector: 'electricity' as const,
    label,
    customerNumber: 'CLIENTE-SECRETO-42',
    active: true,
    createdAt: '2026-10-13T10:00:00.000Z',
  };
}

function invoice(fileHash: string, issueDate: string): Omit<Invoice, 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    contractId: 'c1',
    providerId: 'p1',
    fileHash,
    docType: 'FT',
    issueDate,
    totalCents: 1562,
    qrStatus: 'ok',
    validation: 'not_checked',
    sources: {},
    confidence: {},
    createdAt: '2026-10-13T10:00:00.000Z',
  };
}

describe('sync between two devices', () => {
  it('sends only ciphertext to the server and restores it on another device', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz da casa'));
    const pushed = await runSync({ ...a, api });
    expect(pushed.result.pushed).toBe(1);

    const stored = JSON.stringify(serverDb.prepare('SELECT * FROM records').all());
    expect(stored).not.toContain('Luz da casa');
    expect(stored).not.toContain('CLIENTE-SECRETO-42');
    expect(stored).not.toContain('electricity');
    // Hyphens never occur in base64, so these cannot match ciphertext by chance.
    expect(stored).not.toContain('fornecedor-secreto-1');

    const b = await deviceB();
    const pulled = await runSync({ ...b, api });
    expect(pulled.result.received).toBe(1);
    expect(await b.repos.contracts.get('c1')).toMatchObject({ label: 'Luz da casa' });
    // Indexes rebuilt locally after decrypting.
    expect(await b.repos.contracts.findBy('providerId', 'fornecedor-secreto-1')).toHaveLength(1);
  });

  it('syncs edits and deletions both ways, last write wins', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    await a.repos.contracts.put(contract('c2', 'Gás'));
    let stateA = (await runSync({ ...a, api })).profile;

    const b = await deviceB();
    let stateB = (await runSync({ ...b, api })).profile;
    await b.repos.contracts.put(contract('c1', 'Luz (editado no telemóvel)'));
    await b.repos.contracts.remove('c2');
    stateB = (await runSync({ ...b, profile: stateB, api })).profile;

    stateA = (await on(stateA, () => runSync({ ...a, profile: stateA, api }))).profile;
    expect((await a.repos.contracts.get('c1'))?.label).toBe('Luz (editado no telemóvel)');
    expect(await a.repos.contracts.get('c2')).toBeUndefined();

    // A later edit on A wins over an older one from B.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await a.repos.contracts.put(contract('c1', 'Luz (PC)'));
    await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    await on(stateB, () => runSync({ ...b, profile: stateB, api }));
    expect((await b.repos.contracts.get('c1'))?.label).toBe('Luz (PC)');
  });

  it('does not resend what was already sent', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    const first = await runSync({ ...a, api });
    const second = await runSync({ ...a, profile: first.profile, api });
    expect(second.result.pushed).toBe(0);
  });

  it('refuses a wrong password on the new device', async () => {
    await deviceA();
    await expect(deviceB('errada-errada')).rejects.toMatchObject({ code: 'wrong_credentials' });
  });

  it('checks the local password before enabling sync', async () => {
    const account = await createAccount('rui@example.pt', 'certa-certa-certa', ITERATIONS);
    await expect(
      enableSync({
        ...account,
        password: 'errada',
        serverUrl: SERVER,
        api,
        iterations: ITERATIONS,
      }),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it('turning sync off can delete everything on the server', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    const synced = await runSync({ ...a, api });
    const off = await disableSync({ ...a, profile: synced.profile, deleteRemote: true, api });
    expect(off.sync).toBeUndefined();
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: 0 });
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    // Local data stays.
    expect(await a.repos.contracts.get('c1')).toBeDefined();
  });
});

describe('password change with sync on', () => {
  it('changes the password locally and on the server; the other device signs in again', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    let stateA = (await runSync({ ...a, api })).profile;
    const b = await deviceB();
    let stateB = (await runSync({ ...b, api })).profile;

    stateA = await on(stateA, () =>
      changeAccountPassword({
        ...a,
        profile: stateA,
        currentPassword: 'palavra-passe-longa',
        newPassword: 'outra-palavra-nova',
        api,
        iterations: ITERATIONS,
      }),
    );
    // New password opens the local account; the old one no longer does.
    await expect(unlockAccount('ana@example.pt', 'outra-palavra-nova')).resolves.toBeDefined();
    await expect(unlockAccount('ana@example.pt', 'palavra-passe-longa')).rejects.toMatchObject({
      code: 'wrong_secret',
    });
    // This device keeps syncing with its new session.
    await on(stateA, () => runSync({ ...a, profile: stateA, api }));

    // The other device was signed out; the old password no longer works there.
    await expect(on(stateB, () => runSync({ ...b, profile: stateB, api }))).rejects.toMatchObject({
      code: 'session_expired',
    });
    await expect(
      on(stateB, () =>
        reconnectSync({ ...b, profile: stateB, password: 'palavra-passe-longa', api }),
      ),
    ).rejects.toMatchObject({ code: 'wrong_credentials' });

    stateB = await on(stateB, () =>
      reconnectSync({
        ...b,
        profile: stateB,
        password: 'outra-palavra-nova',
        api,
        localIterations: ITERATIONS,
      }),
    );
    await on(stateB, () => runSync({ ...b, profile: stateB, api }));
    // And its local password is now the new one too.
    await expect(unlockAccount('ana@example.pt', 'outra-palavra-nova')).resolves.toBeDefined();
  });

  it('refuses a wrong current password and changes nothing on the server', async () => {
    const a = await deviceA();
    const before = serverDb.prepare('SELECT auth_hash FROM users').get();
    await expect(
      changeAccountPassword({
        ...a,
        currentPassword: 'errada-errada',
        newPassword: 'outra-palavra-nova',
        api,
        iterations: ITERATIONS,
      }),
    ).rejects.toMatchObject({ code: 'wrong_password' });
    expect(serverDb.prepare('SELECT auth_hash FROM users').get()).toEqual(before);
  });

  it('works without sync (local account only)', async () => {
    const account = await createAccount('rui@example.pt', 'certa-certa-certa', ITERATIONS);
    const changed = await changeAccountPassword({
      ...account,
      currentPassword: 'certa-certa-certa',
      newPassword: 'nova-nova-nova',
      iterations: ITERATIONS,
    });
    expect(changed.sync).toBeUndefined();
    await expect(unlockAccount('rui@example.pt', 'nova-nova-nova')).resolves.toBeDefined();
  });
});

describe('original files', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 fatura com NIF 123456789 e morada secreta');

  it('uploads only ciphertext and other devices download it', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'h1', mime: 'application/pdf', bytes: pdf });
    let stateA = await setFileSync(a.profile, true);
    const sent = await runSync({ ...a, profile: stateA, api });
    stateA = sent.profile;
    expect(sent.files).toEqual({ uploaded: 1, downloaded: 0, pruned: 0, storageFull: false });
    expect(await a.repos.documents.stateOf('h1')).toBe('uploaded');

    const onServer =
      JSON.stringify(fileDb.prepare('SELECT * FROM chunks').all()) +
      JSON.stringify(serverDb.prepare('SELECT * FROM records').all());
    expect(onServer).not.toContain('PDF');
    expect(onServer).not.toContain('123456789');
    expect(onServer).not.toContain('h1');
    expect(onServer).not.toContain('application/pdf');

    // Device B with file sync off: knows the file exists, fetches it on demand.
    const b = await deviceB();
    await runSync({ ...b, api });
    expect(await b.repos.documents.stateOf('h1')).toBe('remote');
    expect(await b.repos.documents.getByFileHash('h1')).toBeUndefined();
    expect(await fetchOriginal({ ...b, fileHash: 'h1', api })).toBe(true);
    const file = await b.repos.documents.getByFileHash('h1');
    expect(new TextDecoder().decode(file?.bytes)).toContain('morada secreta');
    expect(file?.mime).toBe('application/pdf');

    // Nothing is uploaded twice.
    const again = await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    expect(again.files?.uploaded).toBe(0);
  });

  it('downloads automatically when file sync is on', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'h1', mime: 'application/pdf', bytes: pdf });
    await runSync({ ...a, profile: await setFileSync(a.profile, true), api });

    const b = await deviceB();
    const synced = await runSync({ ...b, profile: await setFileSync(b.profile, true), api });
    expect(synced.files?.downloaded).toBe(1);
    expect(await b.repos.documents.stateOf('h1')).toBe('uploaded');
  });

  it('keeps the file local when the server is full, and keeps syncing records', async () => {
    serverWith({ fileQuotaBytes: 10 });
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'h1', mime: 'application/pdf', bytes: pdf });
    await a.repos.contracts.put(contract('c1', 'Luz'));
    const synced = await runSync({ ...a, profile: await setFileSync(a.profile, true), api });
    expect(synced.files?.storageFull).toBe(true);
    expect(synced.result.pushed).toBe(1);
    expect(await a.repos.documents.stateOf('h1')).toBe('local');
  });

  it('keeps only the last 12 months of originals on the server', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await a.repos.documents.put({ fileHash: 'new', mime: 'application/pdf', bytes: pdf });
    await a.repos.documents.put({ fileHash: 'orphan', mime: 'application/pdf', bytes: pdf });
    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    await a.repos.invoices.put(invoice('new', today));
    let stateA = await setFileSync(a.profile, true);

    const first = await runSync({ ...a, profile: stateA, api });
    stateA = first.profile;
    expect(first.files?.pruned).toBe(1);
    expect(await a.repos.documents.stateOf('old')).toBe('pruned');
    expect(await a.repos.documents.stateOf('new')).toBe('uploaded');
    expect(await a.repos.documents.stateOf('orphan')).toBe('uploaded');
    expect((await a.repos.documents.getByFileHash('old'))?.bytes).toBeDefined();
    const files = fileDb.prepare('SELECT COUNT(DISTINCT file_id) AS n FROM chunks').get() as {
      n: number;
    };
    expect(files.n).toBe(2);

    // A device that never had it: knows it exists, does not try to download it.
    const b = await deviceB();
    const synced = await runSync({ ...b, profile: await setFileSync(b.profile, true), api });
    expect(await b.repos.documents.stateOf('old')).toBe('gone');
    expect(await b.repos.documents.getByFileHash('old')).toBeUndefined();
    expect(synced.files?.downloaded).toBe(2);
    expect(synced.files?.pruned).toBe(0);

    // Nothing is pruned or uploaded twice.
    const again = await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    expect(again.files).toMatchObject({ uploaded: 0, pruned: 0 });
  });

  it('marks as pruned on another device that had downloaded it', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    // No invoice yet on A: nothing is pruned on the first sync.
    let stateA = await setFileSync(a.profile, true);
    stateA = (await runSync({ ...a, profile: stateA, api })).profile;

    const b = await deviceB();
    const stateB = (await runSync({ ...b, profile: await setFileSync(b.profile, true), api }))
      .profile;
    expect(await b.repos.documents.stateOf('old')).toBe('uploaded');

    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    await on(stateB, () => runSync({ ...b, profile: stateB, api }));
    expect(await b.repos.documents.stateOf('old')).toBe('pruned');
    expect((await b.repos.documents.getByFileHash('old'))?.bytes).toBeDefined();
  });

  it('never deletes from the server an original this device could not download', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await runSync({ ...a, profile: await setFileSync(a.profile, true), api });

    const b = await deviceB();
    await runSync({ ...b, api }); // files off: B only knows the metadata ('remote')
    await b.repos.invoices.put(invoice('old', '2020-01-10'));
    const failing = new SyncApi(SERVER, async (input, init) => {
      const url = String(input);
      if (
        url.includes('/v1/files/') &&
        !url.endsWith('/usage') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return new Response('down', { status: 503 });
      }
      return serverHandle(new Request(input, init));
    });
    await expect(
      runSync({ ...b, profile: await setFileSync(b.profile, true), api: failing }),
    ).rejects.toBeDefined();
    expect(await b.repos.documents.stateOf('old')).toBe('remote');
    const chunks = fileDb.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number };
    expect(chunks.n).toBe(1);
  });

  it('keeps the original on the server when the announcement cannot be sent', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    let stateA = await setFileSync(a.profile, true);
    stateA = (await runSync({ ...a, profile: stateA, api })).profile;
    await a.repos.invoices.put(invoice('old', '2020-01-10'));

    const failing = new SyncApi(SERVER, async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST' && (await request.clone().text()).includes('"documents"')) {
        return new Response('down', { status: 503 });
      }
      return serverHandle(request);
    });
    await expect(runSync({ ...a, profile: stateA, api: failing })).rejects.toBeDefined();
    const chunks = fileDb.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number };
    expect(chunks.n).toBe(1);
    expect(await a.repos.documents.stateOf('old')).toBe('uploaded');
  });

  it('administrators keep every original on the server', async () => {
    serverWith({ adminEmails: ['ana@example.pt'] });
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    const synced = await runSync({ ...a, profile: await setFileSync(a.profile, true), api });
    expect(synced.files?.pruned).toBe(0);
    expect(await a.repos.documents.stateOf('old')).toBe('uploaded');
  });

  it('counts the window in calendar months', () => {
    expect(monthsBefore(new Date('2026-10-14T09:00:00Z'), 12)).toBe('2025-10-14');
  });

  it('splits contents into chunks', () => {
    expect(chunk('abcdefgh', 4)).toEqual(['abcd', 'efgh']);
    expect(chunk('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('free plan limits', () => {
  it('stores the account id when sync is turned on', async () => {
    const a = await deviceA();
    expect(a.profile.sync?.accountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fills in the account id of older profiles on the next sync', async () => {
    const a = await deviceA();
    const sync = { ...a.profile.sync } as ProfileSync;
    delete sync.accountId;
    const { profile } = await runSync({ ...a, profile: { ...a.profile, sync }, api });
    expect(profile.sync?.accountId).toBe(a.profile.sync?.accountId);
  });

  it('remembers on the profile whether the account is an administrator', async () => {
    serverWith({ adminEmails: ['ana@example.pt'] });
    const a = await deviceA();
    const { profile } = await runSync({ ...a, api });
    expect(profile.sync?.admin).toBe(true);
  });

  it('ordinary accounts are not administrators', async () => {
    const a = await deviceA();
    const { profile } = await runSync({ ...a, api });
    expect(profile.sync?.admin).toBe(false);
  });

  it('says when the server is full for new accounts', async () => {
    serverWith({ maxAccounts: 0 });
    await expect(deviceA()).rejects.toMatchObject({ code: 'capacity' });
  });

  it('says when the records quota is reached', async () => {
    serverWith({ recordQuotaBytes: 10 });
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'records_full' });
  });

  it('turns sync off, keeping the local data, when the account was removed', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz da casa'));
    await runSync({ ...a, api });
    await runMaintenance({ sql: serverSql, now: () => new Date(Date.now() + 400 * 86_400_000) });

    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'account_removed' });
    expect((await profilesDb.profiles.get(a.profile.id))?.sync).toBeUndefined();
    expect((await a.repos.contracts.get('c1'))?.label).toBe('Luz da casa');
  });

  it('still asks for the password when the session ended for another reason', async () => {
    const a = await deviceA();
    serverDb.prepare('DELETE FROM sessions').run();
    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'session_expired' });
    expect((await profilesDb.profiles.get(a.profile.id))?.sync).toBeDefined();
  });
});
