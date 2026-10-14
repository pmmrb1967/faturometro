import { useState } from 'react';
import type { DocumentSyncState } from '../../db/schema';
import { t } from '../../i18n/pt-PT';
import { fetchOriginal } from '../../sync/account';
import { useSession } from '../auth/session-context';

const copy = t.invoices.original;

/** Opens the original PDF/photo of an invoice, fetching it from the sync server if needed. */
export function OriginalButton({
  fileHash,
  state,
}: {
  fileHash: string;
  state: DocumentSyncState;
}) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  if (!session) return null;

  async function open() {
    if (!session) return;
    // Opened now, while the click still counts, so the browser does not block it.
    const target = window.open('', '_blank');
    setBusy(true);
    setProblem(undefined);
    try {
      let file = await session.repos.documents.getByFileHash(fileHash);
      if (!file && state === 'remote') {
        if (await fetchOriginal({ ...session, fileHash })) {
          file = await session.repos.documents.getByFileHash(fileHash);
        }
      }
      if (!file) {
        target?.close();
        setProblem(state === 'gone' ? copy.gone : copy.unavailable);
        return;
      }
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime }));
      if (target) target.location.href = url;
      else window.location.href = url;
      // Long enough for the new tab to load it.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      target?.close();
      setProblem(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="original">
      <button type="button" className="text-button" disabled={busy} onClick={() => void open()}>
        {busy ? copy.opening : state === 'remote' ? copy.openRemote : copy.open}
      </button>
      {problem && (
        <span className="original-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
