import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_BACKUP, ProfilesDb, type AutoBackupConfig } from './profiles';

describe('profiles database v2 (automatic backups)', () => {
  it('keeps the profiles of version 1 and starts with no automatic backup', async () => {
    const name = `profiles-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ profiles: 'id, &email' });
    await v1.table('profiles').add({ id: 'p1', email: 'a@b.pt', createdAt: '2026-11-21' });
    v1.close();

    const db = new ProfilesDb(name);
    expect(await db.profiles.get('p1')).toMatchObject({ email: 'a@b.pt' });
    expect(await db.autoBackups.count()).toBe(0);
    db.close();
  });

  it('stores one configuration per profile', async () => {
    const db = new ProfilesDb(`profiles-${crypto.randomUUID()}`);
    const config: AutoBackupConfig = {
      profileId: 'p1',
      dir: { name: 'Faturometro', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
      dirName: 'Faturometro',
      ...DEFAULT_AUTO_BACKUP,
    };
    await db.autoBackups.put(config);
    await db.autoBackups.put({ ...config, keep: 10 });
    expect(await db.autoBackups.count()).toBe(1);
    expect(await db.autoBackups.get('p1')).toMatchObject({
      every: 'week',
      keep: 10,
      encrypted: true,
      dirName: 'Faturometro',
    });
    db.close();
  });
});
