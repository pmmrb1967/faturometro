import { signedInDrive, signedInLink } from '../../cloud/cloud-drives';
import type { CloudDrive } from '../../cloud/drive';
import { availableProviders } from '../../cloud/providers';
import type { CloudProvider } from '../../db/profiles';
import { t, type CloudService } from '../../i18n/pt-PT';

/** The service's name, company and folder, for the texts. */
export function serviceOf(provider: CloudProvider): CloudService {
  return t.sync.cloud.services[provider];
}

/** The services this build offers, in the order they are shown. */
export function offeredServices(): { provider: CloudProvider; service: CloudService }[] {
  return availableProviders().map((provider) => ({ provider, service: serviceOf(provider) }));
}

/** What the account keeps of a sign-in that just came back. */
export function signInParts(
  provider: CloudProvider,
  accountId: string,
): { drive: CloudDrive; provider: CloudProvider; accountId?: string; refreshToken?: string } {
  const link = signedInLink(provider, accountId);
  return {
    drive: signedInDrive(provider, accountId),
    provider,
    ...(provider === 'onedrive' ? { accountId } : {}),
    ...(link ? { refreshToken: link } : {}),
  };
}
