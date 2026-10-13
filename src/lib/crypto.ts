/**
 * Local account cryptography (WebCrypto only, no dependencies).
 *
 * - A random AES-GCM 256 master key encrypts all profile data.
 * - The master key is stored wrapped twice: with a key derived from the
 *   password (PBKDF2-SHA256) and with a key derived from the recovery key
 *   (HKDF-SHA256; the recovery key is random, so no slow KDF is needed).
 * - Changing the password only re-wraps the master key.
 */
import { decodeBase32, encodeBase32 } from './base32';

export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const RECOVERY_KEY_BYTES = 32;
const AES_GCM = 'AES-GCM';

export interface EncryptedBlob {
  iv: string;
  data: string;
}

export interface PasswordKdf {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
}

export interface WrappedMasterKey {
  /** Master key wrapped with the password-derived key. */
  byPassword: EncryptedBlob;
  kdf: PasswordKdf;
  /** Master key wrapped with the recovery-key-derived key. */
  byRecoveryKey: EncryptedBlob;
  recoverySalt: string;
}

export class WrongSecretError extends Error {
  constructor() {
    super('Wrong password or recovery key');
    this.name = 'WrongSecretError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function passwordKey(password: string, kdf: PasswordKdf): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    material,
    { name: AES_GCM, length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function recoveryKeyKey(recoveryKey: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    decodeRecoveryKey(recoveryKey),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: fromBase64(salt),
      info: encoder.encode('faturometro-recovery'),
    },
    material,
    { name: AES_GCM, length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrap(masterKey: CryptoKey, wrappingKey: CryptoKey): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const data = await crypto.subtle.wrapKey('raw', masterKey, wrappingKey, { name: AES_GCM, iv });
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

async function unwrap(blob: EncryptedBlob, wrappingKey: CryptoKey): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromBase64(blob.data),
      wrappingKey,
      { name: AES_GCM, iv: fromBase64(blob.iv) },
      { name: AES_GCM, length: 256 },
      true, // extractable only so it can be re-wrapped (password change, recovery)
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch {
    throw new WrongSecretError();
  }
}

/** Recovery key: 32 random bytes in Crockford base32, grouped by 4 ("ABCD-EFGH-…"). */
export function generateRecoveryKey(): string {
  return (
    encodeBase32(randomBytes(RECOVERY_KEY_BYTES))
      .match(/.{1,4}/g)
      ?.join('-') ?? ''
  );
}

function decodeRecoveryKey(recoveryKey: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase32(recoveryKey);
  if (bytes === null || bytes.length !== RECOVERY_KEY_BYTES) throw new WrongSecretError();
  return bytes;
}

export interface NewAccountKeys {
  masterKey: CryptoKey;
  wrapped: WrappedMasterKey;
  recoveryKey: string;
}

export async function createAccountKeys(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<NewAccountKeys> {
  const masterKey = await crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, true, [
    'encrypt',
    'decrypt',
    'wrapKey',
    'unwrapKey',
  ]);
  const kdf: PasswordKdf = {
    algorithm: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(randomBytes(SALT_BYTES)),
  };
  const recoveryKey = generateRecoveryKey();
  const recoverySalt = toBase64(randomBytes(SALT_BYTES));
  const wrapped: WrappedMasterKey = {
    byPassword: await wrap(masterKey, await passwordKey(password, kdf)),
    kdf,
    byRecoveryKey: await wrap(masterKey, await recoveryKeyKey(recoveryKey, recoverySalt)),
    recoverySalt,
  };
  return { masterKey, wrapped, recoveryKey };
}

export async function unlockWithPassword(
  wrapped: WrappedMasterKey,
  password: string,
): Promise<CryptoKey> {
  return unwrap(wrapped.byPassword, await passwordKey(password, wrapped.kdf));
}

export async function unlockWithRecoveryKey(
  wrapped: WrappedMasterKey,
  recoveryKey: string,
): Promise<CryptoKey> {
  return unwrap(wrapped.byRecoveryKey, await recoveryKeyKey(recoveryKey, wrapped.recoverySalt));
}

/** Re-wraps the master key with a new password (new salt); the recovery wrap is kept. */
export async function rewrapWithPassword(
  wrapped: WrappedMasterKey,
  masterKey: CryptoKey,
  newPassword: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<WrappedMasterKey> {
  const kdf: PasswordKdf = {
    algorithm: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(randomBytes(SALT_BYTES)),
  };
  return {
    ...wrapped,
    kdf,
    byPassword: await wrap(masterKey, await passwordKey(newPassword, kdf)),
  };
}

export async function encryptBytes(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const data = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, bytes);
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

export async function decryptBytes(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array<ArrayBuffer>> {
  const data = await crypto.subtle.decrypt(
    { name: AES_GCM, iv: fromBase64(blob.iv) },
    key,
    fromBase64(blob.data),
  );
  return new Uint8Array(data);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)));
}

export async function decryptJson(key: CryptoKey, blob: EncryptedBlob): Promise<unknown> {
  return JSON.parse(decoder.decode(await decryptBytes(key, blob)));
}

/** SHA-256 as lowercase hex (file hashes, deduplication keys). */
export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Sync keys (PLAN.md §11): from the password and a salt of their own, two
 * independent keys. The authentication key goes to the server (which stores
 * only its SHA-256); the encryption key never leaves the device and wraps
 * the master key stored on the server.
 */
export interface SyncKeys {
  /** 32 bytes as hex, sent to the server. */
  authKeyHex: string;
  /** Wraps/unwraps the master key; never sent. */
  wrappingKey: CryptoKey;
}

export async function deriveSyncKeys(
  password: string,
  salt: string,
  iterations: number,
): Promise<SyncKeys> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations },
      material,
      512,
    ),
  );
  const authKeyHex = [...bits.slice(0, 32)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    bits.slice(32),
    { name: AES_GCM },
    false,
    ['wrapKey', 'unwrapKey'],
  );
  return { authKeyHex, wrappingKey };
}

export function newSyncSalt(): string {
  return toBase64(randomBytes(SALT_BYTES));
}

/** The master key wrapped for the server: by the sync key, plus the existing recovery wrap. */
export async function wrapForSync(
  local: WrappedMasterKey,
  masterKey: CryptoKey,
  keys: SyncKeys,
): Promise<Pick<WrappedMasterKey, 'byPassword' | 'byRecoveryKey' | 'recoverySalt'>> {
  return {
    byPassword: await wrap(masterKey, keys.wrappingKey),
    byRecoveryKey: local.byRecoveryKey,
    recoverySalt: local.recoverySalt,
  };
}

/** Opens the master key received from the server with the sync wrapping key. */
export async function unwrapFromSync(blob: EncryptedBlob, keys: SyncKeys): Promise<CryptoKey> {
  return unwrap(blob, keys.wrappingKey);
}
