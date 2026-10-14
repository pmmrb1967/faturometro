/**
 * Encryption of layout contributions for the project maintainer: ECDH P-256 with a
 * new ephemeral key per contribution, HKDF-SHA256 and AES-GCM 256 (WebCrypto only).
 * The JSON is gzip-compressed first. Only the maintainer's private key decrypts it.
 */
import { z } from 'zod';
import { fromBase64, toBase64 } from '../../lib/crypto';

export interface Envelope {
  v: 1;
  /** Public half of the ephemeral key. */
  epk: JsonWebKey;
  iv: string;
  data: string;
}

export const MAX_ENVELOPE_DATA = 400_000;

export const envelopeSchema: z.ZodType<Envelope> = z.object({
  v: z.literal(1),
  epk: z
    .object({
      kty: z.literal('EC'),
      crv: z.literal('P-256'),
      x: z.string().max(100),
      y: z.string().max(100),
    })
    .passthrough(),
  iv: z.string().max(40),
  data: z.string().max(MAX_ENVELOPE_DATA),
});

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO = new TextEncoder().encode('faturometro-contribution-v1');

export async function generateMaintainerKeys(): Promise<{
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

async function aesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: GenericTransformStream) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export async function encryptContribution(
  value: unknown,
  publicJwk: JsonWebKey,
): Promise<Envelope> {
  const maintainer = await crypto.subtle.importKey('jwk', publicJwk, ECDH, false, []);
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const key = await aesKey(ephemeral.privateKey, maintainer);
  const plain = await transform(
    new TextEncoder().encode(JSON.stringify(value)),
    new CompressionStream('gzip'),
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    v: 1,
    epk: await crypto.subtle.exportKey('jwk', ephemeral.publicKey),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

export async function decryptContribution(
  envelope: Envelope,
  privateJwk: JsonWebKey,
): Promise<unknown> {
  const maintainer = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const ephemeral = await crypto.subtle.importKey('jwk', envelope.epk, ECDH, false, []);
  const key = await aesKey(maintainer, ephemeral);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data),
    ),
  );
  const json = await transform(plain, new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json)) as unknown;
}
