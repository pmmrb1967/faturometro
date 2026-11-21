/**
 * Google sign-in for the user's Google Drive (the app's sync and backups go to
 * the user's own Drive, never here). Google gives lasting access only to apps
 * that hold a client secret, so the code exchange and the renewals pass through
 * here: the secret is added and the request goes on to Google. Nothing is
 * stored or logged; the tokens only pass through.
 *
 *   POST /v1/google/token {grant: 'code', code, codeVerifier, redirectUri}
 *                         {grant: 'refresh', refreshToken}
 *        → {accessToken, expiresIn, refreshToken?}; 401 when Google refuses the
 *          code or the link (sign in again); 404 when Google is not configured.
 */
import { z } from 'zod';

const TOKEN = 'https://oauth2.googleapis.com/token';
/** The app's return page (CLOUD_RETURN_PATH in src/cloud/oauth.ts). */
export const CLOUD_RETURN_PATH = '/nuvem-retorno';

export interface GoogleApp {
  clientId: string;
  clientSecret: string;
}

const requestSchema = z.discriminatedUnion('grant', [
  z.object({
    grant: z.literal('code'),
    code: z.string().min(1).max(2048),
    codeVerifier: z.string().min(43).max(128),
    redirectUri: z.string().url().max(512),
  }),
  z.object({ grant: z.literal('refresh'), refreshToken: z.string().min(1).max(2048) }),
]);

const replySchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
});

export class GoogleTokenError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function googleToken(input: {
  body: unknown;
  app: GoogleApp | undefined;
  allowedOrigins: readonly string[];
  fetch: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }> {
  if (!input.app) throw new GoogleTokenError(404, 'Not found');
  const parsed = requestSchema.safeParse(input.body);
  if (!parsed.success) throw new GoogleTokenError(400, 'Invalid request');
  const request = parsed.data;

  let form: Record<string, string>;
  if (request.grant === 'code') {
    // Only the app's own return page: the code was issued for it.
    const allowed = input.allowedOrigins.map((origin) => `${origin}${CLOUD_RETURN_PATH}`);
    if (!allowed.includes(request.redirectUri)) {
      throw new GoogleTokenError(400, 'Invalid redirect');
    }
    form = {
      grant_type: 'authorization_code',
      code: request.code,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectUri,
    };
  } else {
    form = { grant_type: 'refresh_token', refresh_token: request.refreshToken };
  }

  let response: Response;
  try {
    response = await input.fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...form,
        client_id: input.app.clientId,
        client_secret: input.app.clientSecret,
      }).toString(),
    });
  } catch {
    throw new GoogleTokenError(502, 'Google unavailable');
  }
  // invalid_grant and the like: the code or the link is no longer valid.
  if (response.status === 400 || response.status === 401) {
    throw new GoogleTokenError(401, 'Sign in again');
  }
  if (!response.ok) throw new GoogleTokenError(502, 'Google unavailable');
  const reply = replySchema.safeParse(await response.json().catch(() => null));
  if (!reply.success) throw new GoogleTokenError(502, 'Unexpected reply');
  return {
    accessToken: reply.data.access_token,
    expiresIn: reply.data.expires_in,
    ...(reply.data.refresh_token ? { refreshToken: reply.data.refresh_token } : {}),
  };
}
