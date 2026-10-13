/**
 * Downloads the ERSE offers and writes public/data/erse-offers.json.
 *
 *   pnpm erse:sync
 *
 * Source: the CSV ZIP linked from the ERSE price simulator, found through
 * https://simuladorprecos.erse.pt/config/Settings.json → csvPath
 * (docs/erse-data.md). Only public market data: no user data involved.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { dataDateFromName, normalize, parseCsv } from './erse/normalize';

const SETTINGS_URL = 'https://simuladorprecos.erse.pt/config/Settings.json';
const OUTPUT = resolve('public', 'data', 'erse-offers.json');

const settingsSchema = z.object({ csvPath: z.string().url() });

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': 'faturometro-erse-sync' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function main(): Promise<void> {
  const settings = settingsSchema.parse(await (await fetchOk(SETTINGS_URL)).json());
  const zipUrl = encodeURI(settings.csvPath);
  const zipName = decodeURIComponent(zipUrl.split('/').pop() ?? '');
  const dataDate = dataDateFromName(zipName);
  if (!dataDate) throw new Error(`Unexpected ERSE file name: ${zipName}`);

  if (existsSync(OUTPUT)) {
    const current = JSON.parse(readFileSync(OUTPUT, 'utf8')) as { source?: string };
    if (current.source === zipName) {
      console.log(`Already up to date (${zipName}).`);
      return;
    }
  }

  const files = unzipSync(new Uint8Array(await (await fetchOk(zipUrl)).arrayBuffer()));
  // Paths in the ZIP use backslashes ("csv\\CondComerciais.csv").
  const byName = new Map(
    Object.entries(files).map(([path, data]) => [path.split(/[\\/]/).pop() ?? path, data]),
  );
  const conditions = byName.get('CondComerciais.csv');
  const prices = byName.get('Precos_ELEGN.csv');
  if (!conditions || !prices)
    throw new Error(`ZIP without the expected CSV files: ${[...byName.keys()].join(', ')}`);

  const file = normalize(parseCsv(strFromU8(conditions)), parseCsv(strFromU8(prices)), {
    source: zipName,
    dataDate,
    fetchedAt: new Date().toISOString(),
  });
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(file)}\n`);
  console.log(
    `✔ ${file.offers.length} electricity offers from ${zipName} → public/data/erse-offers.json`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
