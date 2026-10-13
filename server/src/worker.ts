/** Cloudflare Worker entry point. Configuration in server/wrangler.toml. */
import { createApp } from './app';
import { d1, type D1Like } from './db';

interface Env {
  DB: D1Like;
  /** Original files (encrypted chunks), in a database of their own. */
  FILES?: D1Like;
  /** Secret (wrangler secret put PRELOGIN_SECRET). */
  PRELOGIN_SECRET: string;
  /** Comma-separated app origins. */
  ALLOWED_ORIGINS: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const handle = createApp({
      sql: d1(env.DB),
      ...(env.FILES ? { files: d1(env.FILES) } : {}),
      preloginSecret: env.PRELOGIN_SECRET,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    });
    return handle(request);
  },
};
