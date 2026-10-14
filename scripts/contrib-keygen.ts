/**
 * Creates the maintainer key pair for layout contributions.
 *
 *   pnpm contrib:keygen
 *
 * - The private key goes to CONTRIB_PRIVATE_KEY_FILE or ~/.faturometro/contrib-private.jwk
 *   (never inside the repository; the script refuses it and never overwrites a key).
 * - The public key is printed, to paste into src/features/contribute/maintainer-key.ts.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { generateMaintainerKeys } from '../src/features/contribute/envelope';

function privateKeyPath(): string {
  return resolve(
    process.env.CONTRIB_PRIVATE_KEY_FILE ?? join(homedir(), '.faturometro', 'contrib-private.jwk'),
  );
}

function insideRepository(path: string, root = process.cwd()): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function main() {
  const path = privateKeyPath();
  if (insideRepository(path))
    throw new Error(`Refusing to write the private key inside the repository: ${path}`);
  if (existsSync(path)) throw new Error(`A private key already exists: ${path}`);
  const { publicJwk, privateJwk } = await generateMaintainerKeys();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(privateJwk), { mode: 0o600 });
  console.log(`Private key written to ${path} (keep a safe copy).`);
  console.log('Public key for src/features/contribute/maintainer-key.ts:');
  console.log(
    JSON.stringify({ kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }),
  );
}

main().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
