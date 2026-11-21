import { CloudAccountError } from '../../cloud/cloud-account';
import { CloudError } from '../../cloud/drive';
import { t } from '../../i18n/pt-PT';
import { SyncError } from '../../sync/account';

const copy = t.sync.cloud;

/** Any error of the cloud, the cloud account or the server, as text for the user. */
export function cloudErrorText(error: unknown): string {
  const code =
    error instanceof CloudAccountError || error instanceof CloudError || error instanceof SyncError
      ? error.code
      : 'unexpected';
  if (code === 'offline') return copy.offline;
  return (t.sync.errors as Record<string, string>)[code] ?? t.sync.errors.unexpected;
}
