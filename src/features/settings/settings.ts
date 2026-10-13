import type { Repositories } from '../../db/repositories';
import type { Settings } from '../../domain/types';

/** Defaults from PLAN.md (sections 7 and 9). */
export const DEFAULT_SETTINGS: Omit<Settings, 'updatedAt'> = {
  id: 'settings',
  aiAutoSend: false,
  keepOriginalFiles: true,
  priceIncreaseThresholdPct: 5,
  loyaltyAlertDays: [60, 30, 7],
  autoLockMinutes: 15,
  largeFamily: false,
  cheaperOfferMinSavingCents: 3000,
};

export async function getSettings(repos: Repositories): Promise<Omit<Settings, 'updatedAt'>> {
  return { ...DEFAULT_SETTINGS, ...(await repos.settings.get('settings')) };
}

export async function updateSettings(
  repos: Repositories,
  patch: Partial<Omit<Settings, 'id' | 'updatedAt'>>,
): Promise<Settings> {
  return repos.settings.put({ ...(await getSettings(repos)), ...patch, id: 'settings' });
}
