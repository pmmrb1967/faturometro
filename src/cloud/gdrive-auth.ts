/**
 * Google sign-in for Google Drive: OAuth code flow with PKCE, by redirect.
 * Google gives lasting access only with the app's client secret, which lives
 * in the sync server: the code exchange and the renewals go through
 * POST /v1/google/token there, which adds the secret, passes the request to
 * Google and keeps nothing.
 */
import { z } from 'zod';
import type { AccessToken, FreshTokens } from './dropbox-auth';
import { CloudError } from './drive';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Only the files the app creates (its own folder); not sensitive for Google. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const replySchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  refreshToken: z.string().min(1).optional(),
});

export function googleAuthorizeUrl(
  clientId: string,
  challenge: string,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    // A lasting link (refresh token), asked for again on every sign-in.
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

async function viaServer(
  serverUrl: string,
  body: unknown,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<z.infer<typeof replySchema>> {
  let response: Response;
  try {
    response = await fetchImpl(`${serverUrl}/v1/google/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError('offline');
  }
  if (response.status === 401) throw new CloudError('needs_reconnect');
  if (response.status === 429) throw new CloudError('throttled');
  if (!response.ok) throw new CloudError('unexpected');
  try {
    return replySchema.parse(await response.json());
  } catch {
    throw new CloudError('unexpected');
  }
}

export async function exchangeGoogleCode(input: {
  serverUrl: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<FreshTokens> {
  const reply = await viaServer(
    input.serverUrl,
    {
      grant: 'code',
      code: input.code,
      codeVerifier: input.verifier,
      redirectUri: input.redirectUri,
    },
    input.fetch,
  );
  if (!reply.refreshToken) throw new CloudError('unexpected');
  return {
    accessToken: reply.accessToken,
    refreshToken: reply.refreshToken,
    expiresAt: (input.now ?? Date.now()) + reply.expiresIn * 1000,
  };
}

export async function refreshGoogle(input: {
  serverUrl: string;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<AccessToken> {
  const reply = await viaServer(
    input.serverUrl,
    { grant: 'refresh', refreshToken: input.refreshToken },
    input.fetch,
  );
  return {
    accessToken: reply.accessToken,
    expiresAt: (input.now ?? Date.now()) + reply.expiresIn * 1000,
  };
}
