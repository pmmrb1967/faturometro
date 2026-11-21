/**
 * Encrypted backup: the plain backup ZIP (`exportBackup`) encrypted with the
 * account's master key, next to that key wrapped as the profile keeps it (by
 * the password and by the recovery key). Opening one needs either secret, on
 * any device and into any account; without them only the export date shows.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import {
  decryptBytes,
  encryptBytes,
  fromBase64,
  toBase64,
  unlockWithPassword,
  unlockWithRecoveryKey,
  type WrappedMasterKey,
} from '../../lib/crypto';
import { BackupError, MAX_UNZIPPED_BYTES } from './backup';

export const ENCRYPTED_BACKUP_FORMAT = 'faturometro-encrypted-backup';
export const ENCRYPTED_BACKUP_VERSION = 1;
const HEADER_FILE = 'faturometro-cifrado.json';
const DATA_FILE = 'dados.bin';

const blobSchema = z.object({ iv: z.string().max(100), data: z.string().max(1_000) });

const headerSchema = z.object({
  format: z.literal(ENCRYPTED_BACKUP_FORMAT),
  version: z.literal(ENCRYPTED_BACKUP_VERSION),
  exportedAt: z.string().max(40),
  key: z.object({
    byPassword: blobSchema,
    kdf: z.object({
      algorithm: z.literal('PBKDF2-SHA256'),
      iterations: z.number().int().positive().max(10_000_000),
      salt: z.string().max(100),
    }),
    byRecoveryKey: blobSchema,
    recoverySalt: z.string().max(100),
  }),
  iv: z.string().max(100),
});

export type EncryptedBackupSecret = { password: string } | { recoveryKey: string };

export async function encryptBackup(
  zip: Uint8Array,
  masterKey: CryptoKey,
  wrapped: WrappedMasterKey,
): Promise<Uint8Array> {
  const sealed = await encryptBytes(masterKey, new Uint8Array(zip));
  const header: z.infer<typeof headerSchema> = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    key: wrapped,
    iv: sealed.iv,
  };
  return zipSync({
    [HEADER_FILE]: strToU8(JSON.stringify(header, null, 2)),
    // Ciphertext does not compress; kept binary so it does not grow by a third.
    [DATA_FILE]: [fromBase64(sealed.data), { level: 0 }],
  });
}

/** Uncompressed limits, checked before inflating: a hostile file must not fill memory. */
const MAX_SIZE: Record<string, number> = {
  [HEADER_FILE]: 64_000,
  [DATA_FILE]: MAX_UNZIPPED_BYTES,
};

function entriesOf(bytes: Uint8Array, names: readonly string[]): Record<string, Uint8Array> {
  return unzipSync(bytes, {
    filter: (file) => {
      if (!names.includes(file.name)) return false;
      if (file.originalSize > (MAX_SIZE[file.name] ?? 0)) throw new BackupError('too_large');
      return true;
    },
  });
}

export function isEncryptedBackup(bytes: Uint8Array): boolean {
  try {
    return entriesOf(bytes, [HEADER_FILE])[HEADER_FILE] !== undefined;
  } catch {
    return false;
  }
}

/** The plain backup ZIP, ready for `importBackup`. */
export async function decryptBackup(
  bytes: Uint8Array,
  secret: EncryptedBackupSecret,
): Promise<Uint8Array> {
  let header: z.infer<typeof headerSchema>;
  let data: Uint8Array | undefined;
  try {
    const entries = entriesOf(bytes, [HEADER_FILE, DATA_FILE]);
    const raw = entries[HEADER_FILE];
    data = entries[DATA_FILE];
    if (!raw || !data) throw new Error('missing');
    header = headerSchema.parse(JSON.parse(strFromU8(raw)));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('not_a_backup');
  }

  let masterKey: CryptoKey;
  try {
    masterKey =
      'password' in secret
        ? await unlockWithPassword(header.key, secret.password)
        : await unlockWithRecoveryKey(header.key, secret.recoveryKey);
  } catch {
    // WrongSecretError, or a recovery key in the wrong format: both a wrong secret here.
    throw new BackupError('wrong_secret');
  }
  try {
    return await decryptBytes(masterKey, { iv: header.iv, data: toBase64(data) });
  } catch {
    throw new BackupError('not_a_backup');
  }
}
