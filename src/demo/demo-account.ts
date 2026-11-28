/**
 * The demonstration: a profile of its own, filled with example data and made
 * again at each visit. It never touches the guest's or an account's data.
 */
import Dexie from 'dexie';
import { DEMO_EMAIL, profilesDb, type Profile } from '../db/profiles';
import { createRepositories } from '../db/repositories';
import { ProfileDb, profileDbName } from '../db/schema';
import type { UnlockedAccount } from '../features/auth/accounts';
import { exportMasterKey, generateMasterKey } from '../lib/crypto';

/**
 * Removes the demonstrations on this device (profile, data, backup settings):
 * all of them, or those created before `createdBefore` (ISO date-time).
 */
export async function removeDemos(createdBefore?: string): Promise<void> {
  const demos = await profilesDb.profiles.where('email').equals(DEMO_EMAIL).toArray();
  for (const demo of demos) {
    if (createdBefore !== undefined && demo.createdAt >= createdBefore) continue;
    // The data first: a profile row without data would open empty.
    await Dexie.delete(profileDbName(demo.id));
    await profilesDb.autoBackups.delete(demo.id);
    await profilesDb.profiles.delete(demo.id);
  }
}

/** A new demonstration with its example data, replacing any earlier one. */
export async function createDemo(today?: string): Promise<UnlockedAccount> {
  await removeDemos();
  const masterKey = await generateMasterKey();
  const profile: Profile = {
    id: crypto.randomUUID(),
    email: DEMO_EMAIL,
    createdAt: new Date().toISOString(),
    guestKey: await exportMasterKey(masterKey),
    demo: true,
  };
  const db = new ProfileDb(profile.id);
  try {
    // Its own file: the landing page does not carry the example data.
    const { seedDemo } = await import('./seed');
    await seedDemo(createRepositories(db, masterKey), today);
  } catch (error) {
    db.close();
    await Dexie.delete(profileDbName(profile.id));
    throw error;
  }
  db.close();
  // Only once the data is all there: a failed seed leaves nothing behind.
  await profilesDb.profiles.add(profile);
  return { profile, masterKey };
}
