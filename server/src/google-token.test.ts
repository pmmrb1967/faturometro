import { describe, expect, it } from 'vitest';
import { memorySql } from '../test/sqlite';
import { createApp } from './app';

const ORIGIN = 'https://app.example';
const REDIRECT = `${ORIGIN}/nuvem-retorno`;
const VERIFIER = 'v'.repeat(43);

interface Sent {
  url: string;
  form: Record<string, string>;
}

function setUp(reply: () => Response, configured = true) {
  const memory = memorySql();
  const sent: Sent[] = [];
  const handle = createApp({
    sql: memory.sql,
    preloginSecret: 'secret',
    allowedOrigins: [ORIGIN],
    ...(configured ? { google: { clientId: 'id-google', clientSecret: 'segredo' } } : {}),
    googleFetch: async (input, init) => {
      sent.push({
        url: String(input),
        form: Object.fromEntries(new URLSearchParams(String(init?.body))),
      });
      return reply();
    },
  });
  const call = async (body: unknown) => {
    const response = await handle(
      new Request('https://sync.example/v1/google/token', {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { call, sent, db: memory.db };
}

const google =
  (value: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

describe('POST /v1/google/token', () => {
  it('exchanges the code with the app secret, and keeps nothing', async () => {
    const { call, sent, db } = setUp(
      google({ access_token: 'a1', expires_in: 3599, refresh_token: 'r1', token_type: 'Bearer' }),
    );
    const before = JSON.stringify(db.prepare('SELECT name FROM sqlite_master').all());
    const reply = await call({
      grant: 'code',
      code: 'c',
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT,
    });
    expect(reply).toEqual({
      status: 200,
      body: { accessToken: 'a1', expiresIn: 3599, refreshToken: 'r1' },
    });
    expect(sent[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(sent[0]?.form).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
      client_id: 'id-google',
      client_secret: 'segredo',
    });
    expect(JSON.stringify(db.prepare('SELECT name FROM sqlite_master').all())).toBe(before);
    for (const table of ['users', 'sessions', 'records']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it('renews an access token', async () => {
    const { call, sent } = setUp(google({ access_token: 'a2', expires_in: 3599 }));
    const reply = await call({ grant: 'refresh', refreshToken: 'r1' });
    expect(reply.body).toEqual({ accessToken: 'a2', expiresIn: 3599 });
    expect(sent[0]?.form).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'id-google',
      client_secret: 'segredo',
    });
  });

  it('says when the link is no longer valid', async () => {
    const { call } = setUp(google({ error: 'invalid_grant' }, 400));
    expect((await call({ grant: 'refresh', refreshToken: 'r1' })).status).toBe(401);
  });

  it('refuses a return address of another site, without asking Google', async () => {
    const { call, sent } = setUp(google({}));
    const reply = await call({
      grant: 'code',
      code: 'c',
      codeVerifier: VERIFIER,
      redirectUri: 'https://outro.example/nuvem-retorno',
    });
    expect(reply.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('does not exist without the Google app configured', async () => {
    const { call, sent } = setUp(google({}), false);
    expect((await call({ grant: 'refresh', refreshToken: 'r1' })).status).toBe(404);
    expect(sent).toEqual([]);
  });
});
