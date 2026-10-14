/**
 * Weekly check of the COM.escolha links (docs/anacom-comescolha.md).
 *
 *   pnpm comescolha:check
 *
 * Reads the parameters from ANACOM's query forms and checks that each filter
 * still changes the results. When everything works it records the date in
 * src/data/comescolha.json (and any renamed parameters); the weekly task
 * (scripts/comescolha-weekly.ps1) then commits and pushes, and CI redeploys.
 * If a filter is ignored or a form changed, it keeps the file and exits with
 * code 2 (the task opens an issue). Only public pages are read: no user data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { comEscolhaConfigSchema, type ComEscolhaConfig } from '../src/domain/comescolha';
import { discoverCombined, discoverSearch, resultCount } from './comescolha/discover';
import { probe } from './comescolha/probe';

const OUTPUT = resolve('src', 'data', 'comescolha.json');
const FORMS = {
  combined: 'CombinadosConsulta.do',
  internet: 'InternetConsulta.do',
  tv: 'TelevisaoConsulta.do',
  landline: 'FixoConsulta.do',
  mobile: 'MovelConsulta.do',
} as const;

async function get(url: string): Promise<string> {
  await sleep(1000); // A dozen requests a week, one at a time.
  const response = await fetch(url, { headers: { 'User-Agent': 'faturometro-comescolha-check' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/** Parameters read from the forms, or what could not be found. */
async function discover(current: ComEscolhaConfig): Promise<ComEscolhaConfig | string[]> {
  const form = (path: string) => get(new URL(path, current.base).href);
  const combined = discoverCombined(await form(FORMS.combined));
  const single: Partial<ComEscolhaConfig['single']> = {};
  const missing = 'missing' in combined ? combined.missing.map((what) => `combined: ${what}`) : [];
  for (const service of ['internet', 'tv', 'landline', 'mobile'] as const) {
    const search = discoverSearch(await form(FORMS[service]));
    if ('missing' in search) missing.push(...search.missing.map((what) => `${service}: ${what}`));
    else single[service] = search;
  }
  const { internet, tv, landline, mobile } = single;
  if ('missing' in combined || !internet || !tv || !landline || !mobile) return missing;
  return { ...current, combined, single: { internet, tv, landline, mobile } };
}

/** JSON with sorted keys: the order the forms list inputs in does not matter. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** The same parameters, whatever the dates. */
function sameSearches(a: ComEscolhaConfig, b: ComEscolhaConfig): boolean {
  return (
    canonical({ ...a, changedAt: '', checkedAt: '' }) ===
    canonical({ ...b, changedAt: '', checkedAt: '' })
  );
}

async function main(): Promise<number> {
  const current = comEscolhaConfigSchema.parse(JSON.parse(readFileSync(OUTPUT, 'utf8')));
  const found = await discover(current);
  if (Array.isArray(found)) {
    console.log(
      `## COM.escolha: formulários mudaram\n\nNão encontrado:\n${found.map((what) => `- ${what}`).join('\n')}`,
    );
    return 2;
  }
  const problems = await probe(found, async (url) => resultCount(await get(url)));
  if (problems.length > 0) {
    console.log(
      `## COM.escolha: filtros ignorados\n\nAs ligações da app abririam pesquisas sem estes filtros:\n${problems.map((problem) => `- ${problem}`).join('\n')}\n\nO ficheiro src/data/comescolha.json ficou como estava.`,
    );
    return 2;
  }
  const today = new Date().toISOString().slice(0, 10);
  const changed = !sameSearches(found, current);
  const next = comEscolhaConfigSchema.parse({
    ...found,
    changedAt: changed ? today : current.changedAt,
    checkedAt: today,
  });
  writeFileSync(
    OUTPUT,
    `${JSON.stringify(next, null, 2)}
`,
  );
  console.log(
    changed
      ? 'COM.escolha: parameters changed and work; src/data/comescolha.json updated.'
      : 'COM.escolha: parameters unchanged, every filter works.',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
