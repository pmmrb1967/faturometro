/**
 * The drive of each cloud service, and the sign-in to each: OneDrive through
 * MSAL (src/cloud/onedrive-auth.ts), Dropbox and Google Drive through the PKCE
 * redirect (src/cloud/oauth.ts) and a lasting link kept encrypted in the profile.
 */
import type { CloudProvider, Profile } from '../db/profiles';
import { decryptJson } from '../lib/crypto';
import { DEFAULT_SYNC_URL } from '../sync/config';
import { dropFreshTokens, freshTokens, holdFreshTokens, tokenSource } from './cloud-tokens';
import { CloudError, type CloudDrive } from './drive';
import { Dropbox, type TokenGetter } from './dropbox';
import {
  dropboxAuthorizeUrl,
  exchangeDropboxCode,
  refreshDropbox,
  type AccessToken,
  type FreshTokens,
} from './dropbox-auth';
import { GoogleDrive } from './gdrive';
import { exchangeGoogleCode, googleAuthorizeUrl, refreshGoogle } from './gdrive-auth';
import { startOAuth, type OAuthReturn } from './oauth';
import { OneDrive } from './onedrive';
import {
  completeOneDriveSignIn,
  oneDriveAccountLabel,
  oneDriveToken,
  signInToOneDrive,
} from './onedrive-auth';
import { providerClientId } from './providers';

/** The OneDrive of a signed-in Microsoft account (the last one when not given). */
export function oneDriveFor(accountId?: string): CloudDrive {
  return new OneDrive(() => oneDriveToken(accountId), {
    label: () => oneDriveAccountLabel(accountId),
  });
}

function renewer(provider: 'dropbox' | 'gdrive'): (refreshToken: string) => Promise<AccessToken> {
  return provider === 'dropbox'
    ? (refreshToken) => refreshDropbox({ appKey: providerClientId('dropbox'), refreshToken })
    : (refreshToken) => refreshGoogle({ serverUrl: DEFAULT_SYNC_URL, refreshToken });
}

function linkedDrive(provider: 'dropbox' | 'gdrive', getToken: TokenGetter): CloudDrive {
  return provider === 'dropbox' ? new Dropbox(getToken) : new GoogleDrive(getToken);
}

/** The drive of the profile's cloud account (the master key opens its lasting link). */
export function driveFor(profile: Profile, masterKey?: CryptoKey): CloudDrive {
  const cloud = profile.cloud;
  const provider = cloud?.provider ?? 'onedrive';
  if (provider === 'onedrive') return oneDriveFor(cloud?.accountId);
  const sealed = cloud?.refreshToken;
  return linkedDrive(
    provider,
    tokenSource({
      refreshToken: async () => {
        if (!sealed || !masterKey) return undefined;
        const link: unknown = await decryptJson(masterKey, sealed);
        return typeof link === 'string' ? link : undefined;
      },
      refresh: renewer(provider),
    }),
  );
}

/** The drive right after a sign-in, before the profile has it (`accountId` from the return). */
export function signedInDrive(provider: CloudProvider, accountId: string): CloudDrive {
  if (provider === 'onedrive') return oneDriveFor(accountId);
  const held = freshTokens(accountId);
  return linkedDrive(
    provider,
    tokenSource({
      refreshToken: async () => held?.refreshToken,
      ...(held ? { initial: held } : {}),
      refresh: renewer(provider),
    }),
  );
}

/** The lasting link of a sign-in that just came back (Dropbox and Google Drive). */
export function signedInLink(provider: CloudProvider, accountId: string): string | undefined {
  if (provider === 'onedrive') return undefined;
  return freshTokens(accountId)?.refreshToken;
}

/** Once the profile keeps the link (encrypted): forget the copy in this tab. */
export function forgetSignIn(provider: CloudProvider, accountId: string): void {
  if (provider !== 'onedrive') dropFreshTokens(accountId);
}

/** Leaves for the service's sign-in page; comes back to this page to continue `intent`. */
export async function signInToCloud(provider: CloudProvider, intent: string): Promise<void> {
  if (provider === 'onedrive') return signInToOneDrive(intent);
  const clientId = providerClientId(provider);
  if (!clientId) throw new CloudError('unexpected');
  await startOAuth({
    provider,
    intent,
    authorizeUrl: (challenge, state, redirectUri) =>
      provider === 'dropbox'
        ? dropboxAuthorizeUrl(clientId, challenge, state, redirectUri)
        : googleAuthorizeUrl(clientId, challenge, state, redirectUri),
  });
}

export type CloudSignIn =
  | { provider: CloudProvider; intent: string; accountId: string }
  | { provider: CloudProvider; intent: string; error: string };

/**
 * On start: finishes a sign-in that just came back. `oauth` is the PKCE return
 * (Dropbox, Google Drive); without it, a Microsoft one. Null when there was none.
 */
export async function completeCloudSignIn(oauth: OAuthReturn | null): Promise<CloudSignIn | null> {
  if (!oauth) {
    const microsoft = await completeOneDriveSignIn();
    return microsoft ? { provider: 'onedrive', ...microsoft } : null;
  }
  if ('error' in oauth) {
    return oauth.provider && oauth.intent
      ? { provider: oauth.provider, intent: oauth.intent, error: oauth.error }
      : null;
  }
  const { provider, intent } = oauth;
  try {
    const tokens: FreshTokens =
      provider === 'dropbox'
        ? await exchangeDropboxCode({
            appKey: providerClientId('dropbox'),
            code: oauth.code,
            verifier: oauth.verifier,
            redirectUri: oauth.redirectUri,
          })
        : await exchangeGoogleCode({
            serverUrl: DEFAULT_SYNC_URL,
            code: oauth.code,
            verifier: oauth.verifier,
            redirectUri: oauth.redirectUri,
          });
    return { provider, intent, accountId: holdFreshTokens({ provider, ...tokens }) };
  } catch (error) {
    return {
      provider,
      intent,
      error: error instanceof CloudError ? error.code : 'unexpected',
    };
  }
}
