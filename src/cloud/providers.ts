/** The clouds a profile can sync through, and which ones this build offers. */
import type { CloudProvider } from '../db/profiles';
import {
  PROJECT_DROPBOX_APP_KEY,
  PROJECT_GOOGLE_CLIENT_ID,
  PROJECT_ONEDRIVE_CLIENT_ID,
} from './cloud-config';

function fromBuild(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/** The app's id with each service (not secrets: they only name the app on the sign-in page). */
export function providerClientId(provider: CloudProvider): string {
  switch (provider) {
    case 'onedrive':
      return fromBuild(import.meta.env.VITE_ONEDRIVE_CLIENT_ID, PROJECT_ONEDRIVE_CLIENT_ID);
    case 'dropbox':
      return fromBuild(import.meta.env.VITE_DROPBOX_APP_KEY, PROJECT_DROPBOX_APP_KEY);
    case 'gdrive':
      return fromBuild(import.meta.env.VITE_GOOGLE_CLIENT_ID, PROJECT_GOOGLE_CLIENT_ID);
  }
}

/** A service is offered only when the app is registered with it. */
export function providerAvailable(provider: CloudProvider): boolean {
  return providerClientId(provider) !== '';
}

export const PROVIDER_ORDER: readonly CloudProvider[] = ['onedrive', 'gdrive', 'dropbox'];

export function availableProviders(): CloudProvider[] {
  return PROVIDER_ORDER.filter(providerAvailable);
}

export function providerName(provider: CloudProvider): string {
  switch (provider) {
    case 'onedrive':
      return 'OneDrive';
    case 'gdrive':
      return 'Google Drive';
    case 'dropbox':
      return 'Dropbox';
  }
}
