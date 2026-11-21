import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCloudSync } from '../../cloud/cloud-run';
import { profilesDb, type Profile } from '../../db/profiles';
import { runSync } from '../../sync/account';
import type { Session } from '../auth/session-context';
import { syncSession } from './sync-store';

vi.mock('../../cloud/cloud-run', () => ({ runCloudSync: vi.fn() }));
vi.mock('../../sync/account', async (original) => ({
  ...(await original<typeof import('../../sync/account')>()),
  runSync: vi.fn(),
}));
vi.mock('../alerts/refresh', () => ({ refreshAlerts: vi.fn() }));

const cloudRun = vi.mocked(runCloudSync);
const serverRun = vi.mocked(runSync);

const serverProfile = {
  id: 'p1',
  email: 'a@b.pt',
  createdAt: '2026-11-01',
  sync: { serverUrl: 'https://s', token: {}, lastPulledSeq: 3, lastPushedAt: '' },
} as unknown as Profile;
const movedProfile = {
  id: 'p1',
  email: 'a@b.pt',
  createdAt: '2026-11-01',
  cloud: { provider: 'onedrive', deviceId: 'd', nextSeq: 4, lastPushedAt: '', cursors: {} },
} as Profile;

beforeEach(async () => {
  cloudRun.mockReset();
  serverRun.mockReset();
  await profilesDb.profiles.clear();
});

describe('syncSession', () => {
  it('syncs the profile as saved, not the session’s older copy', async () => {
    // The session still has the server sync; the profile moved to OneDrive since.
    await profilesDb.profiles.put(movedProfile);
    cloudRun.mockResolvedValue({
      profile: movedProfile,
      result: { pushed: 0, received: 0, conflicts: 0 },
    });
    const session = { profile: serverProfile, masterKey: {}, repos: {} } as unknown as Session;
    const update = vi.fn();
    await syncSession(session, update);
    expect(serverRun).not.toHaveBeenCalled();
    expect(cloudRun).toHaveBeenCalledWith(expect.objectContaining({ profile: movedProfile }));
    expect(update).toHaveBeenCalledWith(movedProfile);
  });
});
