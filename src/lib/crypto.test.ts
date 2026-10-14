import { describe, expect, it } from 'vitest';
import { decodeBase32, encodeBase32 } from './base32';
import {
  WrongSecretError,
  createAccountKeys,
  deriveSyncKeys,
  newSyncSalt,
  unwrapFromSync,
  wrapForSync,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  exportMasterKey,
  generateMasterKey,
  importMasterKey,
  rewrapWithPassword,
  sha256Hex,
  unlockWithPassword,
  unlockWithRecoveryKey,
  wrapMasterKey,
} from './crypto';

// Few iterations keep the tests fast; production uses PBKDF2_ITERATIONS.
const ITERATIONS = 1_000;

async function roundTrip(key: CryptoKey): Promise<unknown> {
  return decryptJson(key, await encryptJson(key, { hello: 'olá' }));
}

describe('base32', () => {
  it('round-trips bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
  });

  it('ignores hyphens and accepts common confusions', () => {
    const encoded = encodeBase32(new Uint8Array([0, 1, 2, 3, 4]));
    const grouped =
      encoded
        .match(/.{1,4}/g)
        ?.join('-')
        .toLowerCase()
        .replace(/0/g, 'o') ?? '';
    expect(decodeBase32(grouped)).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
  });

  it('rejects invalid characters', () => {
    expect(decodeBase32('ABC!')).toBeNull();
  });
});

describe('account keys', () => {
  it('unlocks with the password and the recovery key, and both give the same master key', async () => {
    const { masterKey, wrapped, recoveryKey } = await createAccountKeys(
      'palavra-passe certa',
      ITERATIONS,
    );
    const blob = await encryptJson(masterKey, { total: 4279 });

    const byPassword = await unlockWithPassword(wrapped, 'palavra-passe certa');
    const byRecovery = await unlockWithRecoveryKey(wrapped, recoveryKey);
    expect(await decryptJson(byPassword, blob)).toEqual({ total: 4279 });
    expect(await decryptJson(byRecovery, blob)).toEqual({ total: 4279 });
  });

  it('formats the recovery key in groups of four', async () => {
    const { recoveryKey } = await createAccountKeys('x', ITERATIONS);
    expect(recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('rejects a wrong password or recovery key', async () => {
    const { wrapped } = await createAccountKeys('certa', ITERATIONS);
    const other = await createAccountKeys('outra', ITERATIONS);
    await expect(unlockWithPassword(wrapped, 'errada')).rejects.toBeInstanceOf(WrongSecretError);
    await expect(unlockWithRecoveryKey(wrapped, other.recoveryKey)).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    await expect(unlockWithRecoveryKey(wrapped, 'not-a-key')).rejects.toBeInstanceOf(
      WrongSecretError,
    );
  });

  it('changes the password without changing the master key', async () => {
    const { masterKey, wrapped, recoveryKey } = await createAccountKeys('antiga', ITERATIONS);
    const blob = await encryptJson(masterKey, [1, 2, 3]);
    const rewrapped = await rewrapWithPassword(wrapped, masterKey, 'nova', ITERATIONS);

    await expect(unlockWithPassword(rewrapped, 'antiga')).rejects.toBeInstanceOf(WrongSecretError);
    expect(await decryptJson(await unlockWithPassword(rewrapped, 'nova'), blob)).toEqual([1, 2, 3]);
    expect(await decryptJson(await unlockWithRecoveryKey(rewrapped, recoveryKey), blob)).toEqual([
      1, 2, 3,
    ]);
    expect(rewrapped.kdf.salt).not.toBe(wrapped.kdf.salt);
  });

  it('uses a fresh IV for every encryption', async () => {
    const { masterKey } = await createAccountKeys('x', ITERATIONS);
    const a = await encryptJson(masterKey, 'same');
    const b = await encryptJson(masterKey, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(await roundTrip(masterKey)).toEqual({ hello: 'olá' });
  });

  it('detects tampering', async () => {
    const { masterKey } = await createAccountKeys('x', ITERATIONS);
    const blob = await encryptBytes(masterKey, new Uint8Array([1, 2, 3]));
    const tampered = { ...blob, data: blob.data.slice(0, -4) + 'AAAA' };
    await expect(decryptBytes(masterKey, tampered)).rejects.toThrow();
  });
});

describe('sha256Hex', () => {
  it('hashes strings and bytes', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'));
  });
});

describe('sync keys', () => {
  it('derives a stable auth key and a wrapping key that opens the master key', async () => {
    const { masterKey, wrapped } = await createAccountKeys('palavra', ITERATIONS);
    const salt = newSyncSalt();
    const keys = await deriveSyncKeys('palavra', salt, ITERATIONS);
    const again = await deriveSyncKeys('palavra', salt, ITERATIONS);
    expect(keys.authKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(again.authKeyHex).toBe(keys.authKeyHex);

    const forServer = await wrapForSync(wrapped, masterKey, keys);
    const blob = await encryptJson(masterKey, 'segredo');
    expect(await decryptJson(await unwrapFromSync(forServer.byPassword, again), blob)).toBe(
      'segredo',
    );
  });

  it('gives a different auth key for another password or salt', async () => {
    const salt = newSyncSalt();
    const a = await deriveSyncKeys('palavra', salt, ITERATIONS);
    const b = await deriveSyncKeys('outra', salt, ITERATIONS);
    const c = await deriveSyncKeys('palavra', newSyncSalt(), ITERATIONS);
    expect(new Set([a.authKeyHex, b.authKeyHex, c.authKeyHex]).size).toBe(3);
  });

  it('cannot open the master key with a wrong password', async () => {
    const { masterKey, wrapped } = await createAccountKeys('palavra', ITERATIONS);
    const salt = newSyncSalt();
    const forServer = await wrapForSync(
      wrapped,
      masterKey,
      await deriveSyncKeys('palavra', salt, ITERATIONS),
    );
    await expect(
      unwrapFromSync(forServer.byPassword, await deriveSyncKeys('errada', salt, ITERATIONS)),
    ).rejects.toBeInstanceOf(WrongSecretError);
  });
});

describe('stored master key', () => {
  it('exports and imports the same master key', async () => {
    const key = await generateMasterKey();
    const blob = await encryptJson(key, { a: 1 });
    const again = await importMasterKey(await exportMasterKey(key));
    expect(await decryptJson(again, blob)).toEqual({ a: 1 });
  });

  it('wraps an existing master key with a password and a recovery key', async () => {
    const key = await generateMasterKey();
    const blob = await encryptJson(key, 'antes');
    const { wrapped, recoveryKey } = await wrapMasterKey(key, 'segredo-longo', ITERATIONS);
    expect(await decryptJson(await unlockWithPassword(wrapped, 'segredo-longo'), blob)).toBe(
      'antes',
    );
    expect(await decryptJson(await unlockWithRecoveryKey(wrapped, recoveryKey), blob)).toBe(
      'antes',
    );
  });

  it('an imported key can be wrapped again', async () => {
    const key = await importMasterKey(await exportMasterKey(await generateMasterKey()));
    await expect(wrapMasterKey(key, 'segredo-longo', ITERATIONS)).resolves.toBeDefined();
  });
});
