import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb } from '../../db/profiles';
import { decryptJson, encryptJson } from '../../lib/crypto';
import {
  AccountError,
  changePassword,
  convertGuest,
  createAccount,
  createGuest,
  listAccountEmails,
  openGuest,
  recoverAccount,
  unlockAccount,
} from './accounts';

const ITERATIONS = 1_000;

beforeEach(async () => {
  await profilesDb.profiles.clear();
});

async function expectCode(promise: Promise<unknown>, code: AccountError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'AccountError', code });
}

describe('local accounts', () => {
  it('creates an account and unlocks it with the same master key', async () => {
    const created = await createAccount(' Ana@Example.PT ', 'segredo-longo', ITERATIONS);
    const blob = await encryptJson(created.masterKey, 'dados');

    const unlocked = await unlockAccount('ana@example.pt', 'segredo-longo');
    expect(unlocked.profile.id).toBe(created.profile.id);
    expect(await decryptJson(unlocked.masterKey, blob)).toBe('dados');
    expect(await listAccountEmails()).toEqual(['ana@example.pt']);
  });

  it('rejects duplicate emails, unknown emails and wrong passwords', async () => {
    await createAccount('ana@example.pt', 'segredo-longo', ITERATIONS);
    await expectCode(createAccount('ANA@example.pt', 'outro', ITERATIONS), 'email_taken');
    await expectCode(unlockAccount('rui@example.pt', 'segredo-longo'), 'not_found');
    await expectCode(unlockAccount('ana@example.pt', 'errado'), 'wrong_secret');
  });

  it('recovers with the recovery key and sets a new password', async () => {
    const created = await createAccount('ana@example.pt', 'esquecida', ITERATIONS);
    const blob = await encryptJson(created.masterKey, 42);

    await expectCode(
      recoverAccount('ana@example.pt', 'AAAA-BBBB', 'nova', ITERATIONS),
      'wrong_secret',
    );
    const recovered = await recoverAccount(
      'ana@example.pt',
      created.recoveryKey,
      'nova',
      ITERATIONS,
    );
    expect(await decryptJson(recovered.masterKey, blob)).toBe(42);

    await expectCode(unlockAccount('ana@example.pt', 'esquecida'), 'wrong_secret');
    await expect(unlockAccount('ana@example.pt', 'nova')).resolves.toBeDefined();
  });

  it('changes the password only with the current one', async () => {
    const created = await createAccount('ana@example.pt', 'antiga', ITERATIONS);
    await expectCode(changePassword(created, 'errada', 'nova', ITERATIONS), 'wrong_secret');
    await changePassword(created, 'antiga', 'nova', ITERATIONS);
    await expect(unlockAccount('ana@example.pt', 'nova')).resolves.toBeDefined();
  });

  it('keeps several profiles apart', async () => {
    await createAccount('ana@example.pt', 'a', ITERATIONS);
    await createAccount('rui@example.pt', 'b', ITERATIONS);
    await expectCode(unlockAccount('rui@example.pt', 'a'), 'wrong_secret');
    expect(await listAccountEmails()).toEqual(['ana@example.pt', 'rui@example.pt']);
  });
});

describe('guest profile', () => {
  it('creates one guest and opens it again with the same key', async () => {
    const guest = await createGuest();
    const blob = await encryptJson(guest.masterKey, 'fatura');
    expect(guest.profile.email).toBe('');
    expect((await createGuest()).profile.id).toBe(guest.profile.id);
    const opened = await openGuest();
    expect(await decryptJson(opened!.masterKey, blob)).toBe('fatura');
    expect(await listAccountEmails()).toEqual([]);
  });

  it('openGuest is null without a guest', async () => {
    expect(await openGuest()).toBeNull();
  });

  it('converts a guest: same data, password and recovery key open it, raw key gone', async () => {
    const guest = await createGuest();
    const blob = await encryptJson(guest.masterKey, 'antes');
    const { profile, recoveryKey } = await convertGuest(
      guest,
      ' Ana@Example.PT ',
      'segredo-longo',
      ITERATIONS,
    );
    expect(profile.id).toBe(guest.profile.id);
    expect(profile.email).toBe('ana@example.pt');
    expect(profile.guestKey).toBeUndefined();
    expect((await profilesDb.profiles.get(profile.id))?.guestKey).toBeUndefined();
    expect(await openGuest()).toBeNull();
    const unlocked = await unlockAccount('ana@example.pt', 'segredo-longo');
    expect(await decryptJson(unlocked.masterKey, blob)).toBe('antes');
    const recovered = await recoverAccount('ana@example.pt', recoveryKey, 'outra-longa', ITERATIONS);
    expect(await decryptJson(recovered.masterKey, blob)).toBe('antes');
  });

  it('refuses an email already used here and keeps the guest', async () => {
    await createAccount('ana@example.pt', 'segredo-longo', ITERATIONS);
    const guest = await createGuest();
    await expectCode(
      convertGuest(guest, 'ANA@example.pt', 'x-segredo-longo', ITERATIONS),
      'email_taken',
    );
    expect((await openGuest())?.profile.id).toBe(guest.profile.id);
  });

  it('a guest cannot be opened with a password', async () => {
    await createGuest();
    await expectCode(unlockAccount('', 'qualquer'), 'not_found');
  });
});
