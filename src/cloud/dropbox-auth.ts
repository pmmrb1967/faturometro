/**
 * Dropbox sign-in, in the browser only: OAuth code flow with PKCE and a lasting
 * link (`token_access_type=offline`), with no app secret. The tokens go only to
 * Dropbox.
 */
import { z } from 'zod';
import { CloudError } from './drive';

const AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';

export interface AccessToken {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface FreshTokens extends AccessToken {
  refreshToken: string;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
});

export function dropboxAuthorizeUrl(
  appKey: string,
  challenge: string,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

async function token(
  form: Record<string, string>,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<z.infer<typeof tokenSchema>> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new CloudError('offline');
  }
  // A code or link that is no longer valid: sign in again.
  if (response.status === 400 || response.status === 401) throw new CloudError('needs_reconnect');
  if (!response.ok) throw new CloudError(response.status === 429 ? 'throttled' : 'unexpected');
  try {
    return tokenSchema.parse(await response.json());
  } catch {
    throw new CloudError('unexpected');
  }
}

export async function exchangeDropboxCode(input: {
  appKey: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<FreshTokens> {
  const reply = await token(
    {
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.appKey,
      redirect_uri: input.redirectUri,
    },
    input.fetch,
  );
  if (!reply.refresh_token) throw new CloudError('unexpected');
  return {
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt: (input.now ?? Date.now()) + reply.expires_in * 1000,
  };
}

export async function refreshDropbox(input: {
  appKey: string;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<AccessToken> {
  const reply = await token(
    { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: input.appKey },
    input.fetch,
  );
  return {
    accessToken: reply.access_token,
    expiresAt: (input.now ?? Date.now()) + reply.expires_in * 1000,
  };
}
