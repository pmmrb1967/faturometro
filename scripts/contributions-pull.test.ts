import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptContribution, generateMaintainerKeys } from '../src/features/contribute/envelope';
import { saveContribution } from './contributions-pull';

const CONTRIBUTION = {
  version: 1,
  createdAt: '2026-10-14T00:00:00.000Z',
  issuerNif: '500000000',
  context: { pages: 1 },
  pages: [{ page: 1, width: 595, height: 842, items: [] }],
  qrs: [{ text: 'A:500000000*F:20260101*O:1.00' }],
};

describe('saveContribution', () => {
  it('decrypts and writes a fixture under the issuer NIF', async () => {
    const keys = await generateMaintainerKeys();
    const root = mkdtempSync(join(tmpdir(), 'contrib-'));
    const envelope = await encryptContribution(CONTRIBUTION, keys.publicJwk);
    const path = await saveContribution(envelope, keys.privateJwk, root, 'abc');
    expect(path).toBe(join(root, '500000000', 'abc.json'));
    const saved = JSON.parse(readFileSync(path, 'utf8')) as typeof CONTRIBUTION;
    expect(saved.pages).toEqual(CONTRIBUTION.pages);
    expect(saved.qrs).toEqual(CONTRIBUTION.qrs);
  });

  it('writes nothing when it cannot decrypt', async () => {
    const a = await generateMaintainerKeys();
    const b = await generateMaintainerKeys();
    const root = mkdtempSync(join(tmpdir(), 'contrib-'));
    const envelope = await encryptContribution(CONTRIBUTION, a.publicJwk);
    await expect(saveContribution(envelope, b.privateJwk, root, 'abc')).rejects.toThrow();
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });
});
