import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb } from '../../db/profiles';
import { decryptJson, encryptJson } from '../../lib/crypto';
import { createAccount } from './accounts';
import {
  forgetSession,
  rememberSession,
  restoreSession,
  SESSION_IDLE_MINUTES,
  touchSession,
} from './session-store';

/** sessionStorage of one tab (Node has none). */
function newTab() {
  const items = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
  return items;
}

const MINUTE = 60_000;
const T0 = Date.parse('2026-10-15T10:00:00Z');

beforeEach(async () => {
  await profilesDb.profiles.clear();
  newTab();
});

describe('session kept across reloads', () => {
  it('reopens the same account with a key that opens its data', async () => {
    const account = await createAccount('ana@example.pt', 'segredo-longo', 1_000);
    const secret = await encryptJson(account.masterKey, { ok: 1 });
    await rememberSession(account, T0);

    const restored = await restoreSession(T0 + 5 * MINUTE);
    expect(restored?.profile.id).toBe(account.profile.id);
    expect(await decryptJson(restored!.masterKey, secret)).toEqual({ ok: 1 });
  });

  it('keeps no master key in clear in the tab storage', async () => {
    const tab = newTab();
    const account = await createAccount('ana@example.pt', 'segredo-longo', 1_000);
    await rememberSession(account, T0);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', account.masterKey));
    const stored = [...tab.values()].join();
    expect(stored).not.toContain(btoa(String.fromCharCode(...raw)));
  });

  it('expires after the idle period, unless there was activity', async () => {
    const account = await createAccount('ana@example.pt', 'segredo-longo', 1_000);
    await rememberSession(account, T0);
    await touchSession(T0 + 20 * MINUTE);
    expect(await restoreSession(T0 + (20 + SESSION_IDLE_MINUTES - 1) * MINUTE)).not.toBeNull();

    await rememberSession(account, T0);
    expect(await restoreSession(T0 + (SESSION_IDLE_MINUTES + 1) * MINUTE)).toBeNull();
    // Expired means gone: not even a fresh clock brings it back.
    expect(await restoreSession(T0)).toBeNull();
  });

  it('ends with signing out, and is not seen by another tab', async () => {
    const account = await createAccount('ana@example.pt', 'segredo-longo', 1_000);
    await rememberSession(account, T0);
    newTab();
    expect(await restoreSession(T0)).toBeNull();

    await rememberSession(account, T0);
    await forgetSession();
    expect(await restoreSession(T0)).toBeNull();
  });

  it('ends when the account was deleted', async () => {
    const account = await createAccount('ana@example.pt', 'segredo-longo', 1_000);
    await rememberSession(account, T0);
    await profilesDb.profiles.delete(account.profile.id);
    expect(await restoreSession(T0)).toBeNull();
  });
});
