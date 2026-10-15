/**
 * Keeps a signed-in session across page reloads, in this tab only.
 *
 * The master key is encrypted with a per-tab session key that the page can
 * use but never read (a non-extractable CryptoKey, kept in IndexedDB). The
 * encrypted master key lives in sessionStorage, which the browser drops when
 * the tab closes. Neither piece alone opens the data; both expire after
 * SESSION_IDLE_MINUTES without activity, and signing out deletes them.
 */
import Dexie, { type Table } from 'dexie';
import { profilesDb } from '../../db/profiles';
import {
  decryptBytes,
  encryptBytes,
  exportMasterKey,
  fromBase64,
  importMasterKey,
  toBase64,
  type EncryptedBlob,
} from '../../lib/crypto';
import type { UnlockedAccount } from './accounts';

export const SESSION_IDLE_MINUTES = 30;
const STORAGE_ITEM = 'faturometro-session';

interface SessionKeyRow {
  id: string;
  profileId: string;
  key: CryptoKey;
  lastActive: number;
}

class SessionKeysDb extends Dexie {
  keys!: Table<SessionKeyRow, string>;

  constructor() {
    super('faturometro-session');
    this.version(1).stores({ keys: 'id, lastActive' });
  }
}

const db = new SessionKeysDb();

interface TabSession {
  id: string;
  wrapped: EncryptedBlob;
}

function readTab(): TabSession | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_ITEM);
    return raw ? (JSON.parse(raw) as TabSession) : undefined;
  } catch {
    return undefined;
  }
}

function idleLimit(now: number): number {
  return now - SESSION_IDLE_MINUTES * 60_000;
}

/** After signing in: lets a reload of this tab reopen the session. */
export async function rememberSession(account: UnlockedAccount, now = Date.now()): Promise<void> {
  try {
    await forgetSession();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const raw = fromBase64(await exportMasterKey(account.masterKey));
    const tab: TabSession = { id: crypto.randomUUID(), wrapped: await encryptBytes(key, raw) };
    // Keys of tabs closed without signing out are useless; drop the expired ones.
    await db.keys.where('lastActive').below(idleLimit(now)).delete();
    await db.keys.put({ id: tab.id, profileId: account.profile.id, key, lastActive: now });
    sessionStorage.setItem(STORAGE_ITEM, JSON.stringify(tab));
  } catch {
    // Private windows or blocked storage: the session just ends at reload, as before.
  }
}

/** Activity in the app: the session stays reopenable for another idle period. */
export async function touchSession(now = Date.now()): Promise<void> {
  const tab = readTab();
  if (!tab) return;
  try {
    await db.keys.update(tab.id, { lastActive: now });
  } catch {
    // Nothing to do: the session simply expires sooner.
  }
}

/** On load: the session of this tab, if it was not closed, signed out or idle too long. */
export async function restoreSession(now = Date.now()): Promise<UnlockedAccount | null> {
  const tab = readTab();
  if (!tab) return null;
  try {
    const row = await db.keys.get(tab.id);
    if (!row || row.lastActive < idleLimit(now)) {
      await forgetSession();
      return null;
    }
    const profile = await profilesDb.profiles.get(row.profileId);
    if (!profile) {
      await forgetSession();
      return null;
    }
    const masterKey = await importMasterKey(toBase64(await decryptBytes(row.key, tab.wrapped)));
    await db.keys.update(tab.id, { lastActive: now });
    return { profile, masterKey };
  } catch {
    await forgetSession();
    return null;
  }
}

/** Signing out, or the app locking itself: a reload asks for the password again. */
export async function forgetSession(): Promise<void> {
  const tab = readTab();
  try {
    sessionStorage.removeItem(STORAGE_ITEM);
  } catch {
    // Storage unavailable: nothing was kept there.
  }
  if (!tab) return;
  try {
    await db.keys.delete(tab.id);
  } catch {
    // The key is useless without the encrypted copy just removed.
  }
}
