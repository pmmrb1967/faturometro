/**
 * Administrators who sync through their own cloud keep a link to the sync
 * server: the badge, the layout contributions waiting and the usage totals.
 * Only a session token (encrypted on the device) is kept; no data goes there.
 */
import { profilesDb, type Profile } from '../db/profiles';
import { decryptJson, deriveSyncKeys, encryptJson } from '../lib/crypto';
import { fromHttp, SyncError } from './account';
import { SyncApi, SyncHttpError } from './api';

/** Administrator by the server sync or by the administrator link. */
export function isAdmin(profile: Profile): boolean {
  return Boolean(profile.sync?.admin || profile.adminLink);
}

export function adminContributions(profile: Profile): number {
  if (profile.sync?.admin) return profile.sync.contributions ?? 0;
  return profile.adminLink?.contributions ?? 0;
}

/** The token of the server session that gives administrator access (either source). */
export async function adminSession(
  profile: Profile,
  masterKey: CryptoKey,
): Promise<{ serverUrl: string; token: string } | null> {
  const source = profile.sync?.admin ? profile.sync : profile.adminLink;
  if (!source) return null;
  return {
    serverUrl: source.serverUrl,
    token: (await decryptJson(masterKey, source.token)) as string,
  };
}

async function save(profile: Profile, patch: Pick<Profile, 'adminLink'>): Promise<Profile> {
  const stored = (await profilesDb.profiles.get(profile.id)) ?? profile;
  const updated: Profile = { ...stored, ...patch };
  await profilesDb.profiles.put(updated);
  return updated;
}

/** Signs in to the server with the account's password; refuses accounts that are not administrators. */
export async function linkAdmin(input: {
  profile: Profile;
  masterKey: CryptoKey;
  password: string;
  serverUrl: string;
  api?: SyncApi;
}): Promise<Profile> {
  const api = input.api ?? new SyncApi(input.serverUrl);
  let token: string;
  try {
    const { salt, iterations } = await api.prelogin(input.profile.email);
    const keys = await deriveSyncKeys(input.password, salt, iterations);
    token = (await api.login(input.profile.email, keys.authKeyHex)).token;
  } catch (error) {
    fromHttp(error, { 401: 'wrong_credentials', 429: 'locked' });
  }
  try {
    await api.adminStats(token);
  } catch (error) {
    if (error instanceof SyncHttpError && error.status === 403) {
      await api.logout(token).catch(() => undefined);
      throw new SyncError('not_admin');
    }
    fromHttp(error, {});
  }
  return save(input.profile, {
    adminLink: {
      serverUrl: input.serverUrl,
      token: await encryptJson(input.masterKey, token),
      checkedAt: new Date().toISOString(),
    },
  });
}

/** With each sync: how many layout contributions wait. */
export async function refreshAdminLink(input: {
  profile: Profile;
  masterKey: CryptoKey;
  api?: SyncApi;
}): Promise<Profile> {
  const link = input.profile.adminLink;
  if (!link) return input.profile;
  const api = input.api ?? new SyncApi(link.serverUrl);
  const token = (await decryptJson(input.masterKey, link.token)) as string;
  let contributions: number | undefined;
  try {
    // Past the last change: no records, only the account's flags.
    contributions = (await api.pull(token, Number.MAX_SAFE_INTEGER)).contributions;
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
  return save(input.profile, {
    adminLink: {
      ...link,
      ...(contributions !== undefined ? { contributions } : {}),
      checkedAt: new Date().toISOString(),
    },
  });
}
