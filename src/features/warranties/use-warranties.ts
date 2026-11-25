import { useLiveQuery } from 'dexie-react-hooks';
import type { DocumentSyncState } from '../../db/schema';
import { sortWarranties } from '../../domain/warranty';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';

/** Warranties with where their document is (here, only on the server, or nowhere). */
export function useWarranties() {
  const { session } = useSession();
  return useLiveQuery(async () => {
    if (!session) return null;
    const warranties = await session.repos.warranties.list();
    const states = new Map<string, DocumentSyncState | undefined>();
    for (const warranty of warranties) {
      if (warranty.fileHash) {
        states.set(warranty.fileHash, await session.repos.documents.stateOf(warranty.fileHash));
      }
    }
    return { warranties: sortWarranties(warranties, today()), states };
  }, [session]);
}
