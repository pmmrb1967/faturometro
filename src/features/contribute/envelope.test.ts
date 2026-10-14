import { describe, expect, it } from 'vitest';
import {
  decryptContribution,
  encryptContribution,
  envelopeSchema,
  generateMaintainerKeys,
} from './envelope';

describe('contribution envelope', () => {
  it('round-trips with the maintainer key pair', async () => {
    const { publicJwk, privateJwk } = await generateMaintainerKeys();
    const value = { hello: 'olá', n: [1, 2, 3] };
    const envelope = await encryptContribution(value, publicJwk);
    expect(envelopeSchema.safeParse(envelope).success).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('olá');
    expect(await decryptContribution(envelope, privateJwk)).toEqual(value);
  });

  it('fails with another private key', async () => {
    const a = await generateMaintainerKeys();
    const b = await generateMaintainerKeys();
    const envelope = await encryptContribution({ x: 1 }, a.publicJwk);
    await expect(decryptContribution(envelope, b.privateJwk)).rejects.toThrow();
  });
});
