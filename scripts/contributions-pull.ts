/**
 * Downloads the layout contributions sent by users, decrypts them with the maintainer's
 * private key and writes them as private fixtures; each one is deleted from the server
 * only after its file is written.
 *
 *   CONTRIB_ADMIN_TOKEN=… pnpm contributions:pull
 *
 * - Private key: CONTRIB_PRIVATE_KEY_FILE or ~/.faturometro/contrib-private.jwk
 *   (pnpm contrib:keygen).
 * - Server: SYNC_URL or the project's server.
 * - Output: fixtures/private/contributions/<issuer NIF>/<id>.json (git-ignored).
 *
 * Prints counts only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { decryptContribution, envelopeSchema } from '../src/features/contribute/envelope';
import { PROJECT_SYNC_URL } from '../src/sync/default-server';

const contributionSchema = z.object({
  issuerNif: z.string().regex(/^(\d{9})?$/),
  pages: z.array(z.unknown()),
  qrs: z.array(z.object({ text: z.string() })),
});

export async function saveContribution(
  envelope: unknown,
  privateJwk: JsonWebKey,
  root: string,
  id: string,
): Promise<string> {
  const contribution = contributionSchema
    .passthrough()
    .parse(await decryptContribution(envelopeSchema.parse(envelope), privateJwk));
  const dir = join(root, contribution.issuerNif || 'unknown');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id.replace(/[^0-9a-f-]/gi, '')}.json`);
  writeFileSync(path, `${JSON.stringify(contribution, null, 2)}\n`);
  return path;
}

const listSchema = z.object({
  contributions: z.array(z.object({ id: z.string(), envelope: z.unknown() })),
});

async function main() {
  const token = process.env.CONTRIB_ADMIN_TOKEN;
  if (!token) throw new Error('Set CONTRIB_ADMIN_TOKEN');
  const keyFile =
    process.env.CONTRIB_PRIVATE_KEY_FILE ?? join(homedir(), '.faturometro', 'contrib-private.jwk');
  const privateJwk = JSON.parse(readFileSync(keyFile, 'utf8')) as JsonWebKey;
  const server = process.env.SYNC_URL ?? PROJECT_SYNC_URL;
  const root = resolve('fixtures', 'private', 'contributions');
  const headers = { Authorization: `Bearer ${token}` };
  let saved = 0;
  let failed = 0;
  for (;;) {
    const response = await fetch(`${server}/v1/contributions`, { headers });
    if (!response.ok) throw new Error(`Server answered ${response.status}`);
    const { contributions } = listSchema.parse(await response.json());
    if (contributions.length === 0) break;
    let progress = false;
    for (const { id, envelope } of contributions) {
      try {
        await saveContribution(envelope, privateJwk, root, id);
        saved++;
      } catch {
        failed++;
        continue; // kept on the server, to look at by hand
      }
      const removed = await fetch(`${server}/v1/contributions/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (removed.ok) progress = true;
    }
    if (!progress) break;
  }
  console.log(
    `✔ ${saved} contribution(s) saved in fixtures/private/contributions; ${failed} failed`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
