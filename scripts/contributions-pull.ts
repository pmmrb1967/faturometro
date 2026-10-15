/**
 * Downloads the layout contributions sent by users, decrypts them with the maintainer's
 * private key and writes them as private fixtures; each one is deleted from the server
 * only after its file is written.
 *
 *   pnpm contributions:pull
 *
 * - Token: CONTRIB_ADMIN_TOKEN or ~/.faturometro/contrib-admin-token.
 * - Private key: CONTRIB_PRIVATE_KEY_FILE or ~/.faturometro/contrib-private.jwk
 *   (pnpm contrib:keygen).
 * - Server: SYNC_URL or the project's server.
 * - Output: fixtures/private/contributions/<issuer NIF>/<id>.json (git-ignored).
 *
 * Prints counts only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Pulls until the server is empty. A contribution that cannot be decrypted or is not a
 * contribution (anyone can post to the public endpoint) is deleted too, so junk never
 * blocks the queue; its id is reported.
 */
export async function pullAll(options: {
  server: string;
  token: string;
  privateJwk: JsonWebKey;
  root: string;
  fetch?: typeof fetch;
}): Promise<{ saved: number; discarded: string[] }> {
  const send = options.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${options.token}` };
  let saved = 0;
  const discarded: string[] = [];
  for (;;) {
    const response = await send(`${options.server}/v1/contributions`, { headers });
    if (!response.ok) throw new Error(`Server answered ${response.status}`);
    const { contributions } = listSchema.parse(await response.json());
    if (contributions.length === 0) break;
    let removedAny = false;
    for (const { id, envelope } of contributions) {
      try {
        await saveContribution(envelope, options.privateJwk, options.root, id);
        saved++;
      } catch {
        discarded.push(id);
      }
      const removed = await send(`${options.server}/v1/contributions/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (removed.ok) removedAny = true;
    }
    if (!removedAny) throw new Error('Could not delete contributions from the server');
  }
  return { saved, discarded };
}

async function main() {
  const tokenFile = join(homedir(), '.faturometro', 'contrib-admin-token');
  const token =
    process.env.CONTRIB_ADMIN_TOKEN ??
    (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : undefined);
  if (!token)
    throw new Error('Set CONTRIB_ADMIN_TOKEN or write ~/.faturometro/contrib-admin-token');
  const keyFile =
    process.env.CONTRIB_PRIVATE_KEY_FILE ?? join(homedir(), '.faturometro', 'contrib-private.jwk');
  const { saved, discarded } = await pullAll({
    server: process.env.SYNC_URL ?? PROJECT_SYNC_URL,
    token,
    privateJwk: JSON.parse(readFileSync(keyFile, 'utf8')) as JsonWebKey,
    root: resolve('fixtures', 'private', 'contributions'),
  });
  console.log(`✔ ${saved} contribution(s) saved in fixtures/private/contributions`);
  if (discarded.length > 0) {
    console.log(`  ${discarded.length} unreadable, deleted: ${discarded.join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
