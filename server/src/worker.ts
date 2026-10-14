/** Cloudflare Worker entry point. Configuration in server/wrangler.toml. */
import { createApp } from './app';
import { d1 } from './db';
import { limitsFromEnv, type Env } from './env';
import { runMaintenance } from './maintenance';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // Spread: createApp ignores `inactiveMonths` (used only by the scheduled job).
    const handle = createApp({
      sql: d1(env.DB),
      ...(env.FILES ? { files: d1(env.FILES) } : {}),
      preloginSecret: env.PRELOGIN_SECRET,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
      ...limitsFromEnv(env),
      ...(env.CONTRIB_ADMIN_TOKEN ? { contribAdminToken: env.CONTRIB_ADMIN_TOKEN } : {}),
    });
    return handle(request);
  },

  /** Daily Cron Trigger: inactive accounts and usage totals. */
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const { adminEmails, inactiveMonths } = limitsFromEnv(env);
    ctx.waitUntil(
      runMaintenance({
        sql: d1(env.DB),
        ...(env.FILES ? { files: d1(env.FILES) } : {}),
        adminEmails,
        ...(inactiveMonths !== undefined ? { inactiveMonths } : {}),
      }),
    );
  },
};
