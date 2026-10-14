/**
 * Weekly check of the sync server's usage (.github/workflows/sync-capacity.yml).
 * Reads `wrangler d1 execute --json` output on stdin, prints a Markdown report
 * and exits with code 2 when a limit passes ALERT_PERCENT. Totals only.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const ALERT_PERCENT = 70;

/** Free plan limits as configured in server/wrangler.toml and server/src/app.ts. */
export const LIMITS = { accounts: 200, records_bytes: 500_000_000, files_bytes: 450_000_000 };
type Limits = typeof LIMITS;

const statsSchema = z.object({
  accounts: z.number(),
  records_bytes: z.number(),
  files_bytes: z.number(),
  computed_at: z.string(),
});
export type UsageStats = z.infer<typeof statsSchema>;

export function parseStats(output: string): UsageStats {
  const parsed = z.array(z.object({ results: z.array(z.unknown()) })).parse(JSON.parse(output));
  const row = parsed[0]?.results[0];
  if (!row) throw new Error('No stats row yet: the daily job has not run.');
  return statsSchema.parse(row);
}

export function report(
  stats: UsageStats,
  limits: Limits = LIMITS,
): { alert: boolean; text: string } {
  const rows: [string, number][] = [
    ['Contas', stats.accounts / limits.accounts],
    ['Registos', stats.records_bytes / limits.records_bytes],
    ['Originais', stats.files_bytes / limits.files_bytes],
  ];
  const alert = rows.some(([, share]) => share * 100 >= ALERT_PERCENT);
  const text = [
    `Ocupação do servidor de sincronização (calculada a ${stats.computed_at}):`,
    '',
    '| Recurso | Ocupação |',
    '|---|---|',
    ...rows.map(([name, share]) => `| ${name} | ${Math.floor(share * 100)}% |`),
    '',
    alert
      ? `Pelo menos um recurso passou ${ALERT_PERCENT}%. Opções: apertar as quotas em server/wrangler.toml ou rever o plano (docs/superpowers/specs/2026-10-14-sync-capacity-design.md).`
      : `Tudo abaixo de ${ALERT_PERCENT}%.`,
  ].join('\n');
  return { alert, text };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { alert, text } = report(parseStats(readFileSync(0, 'utf8')));
  console.log(text);
  process.exitCode = alert ? 2 : 0;
}
