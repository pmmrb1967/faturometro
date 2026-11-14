import type { RemovedKind } from '../../ai/anonymize';
import { t } from '../../i18n/pt-PT';

/** "3 nomes, 1 NIF e 2 moradas". */
export function describeRemoved(removed: Partial<Record<RemovedKind, number>>): string {
  const parts = Object.entries(removed).map(([kind, count]) => {
    const names = t.ai.free.kinds[kind] ?? [kind, kind];
    return `${count} ${names[count === 1 ? 0 : 1]}`;
  });
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}
