import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';

const copy = t.ingest.attachOriginal;

/**
 * An invoice already stored (e.g. added on another device) without its
 * original anywhere: offers to keep the file just read as its original.
 */
export function AttachOriginal({
  invoiceId,
  file,
}: {
  invoiceId: string;
  file: { mime: string; bytes: Uint8Array<ArrayBuffer> };
}) {
  const { session } = useSession();
  const [status, setStatus] = useState<'saved' | 'failed'>();
  const fileHash = useLiveQuery(
    async () => (await session?.repos.invoices.get(invoiceId))?.fileHash,
    [session, invoiceId],
  );
  const needed = useLiveQuery(
    async () => (fileHash ? session?.repos.documents.needsOriginal(fileHash) : false),
    [session, fileHash],
  );
  if (!session) return null;
  if (status === 'saved') {
    return (
      <p role="status" className="doc-saved">
        {copy.saved}
      </p>
    );
  }
  if (!fileHash || !needed) return null;

  async function attach() {
    if (!session || !fileHash) return;
    try {
      // Without a type it can only be a PDF (images are recognised by their type).
      const mime = file.mime || 'application/pdf';
      const attached = await session.repos.documents.attach(fileHash, { mime, bytes: file.bytes });
      setStatus(attached ? 'saved' : 'failed');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="attach-original">
      <p className="muted">{copy.hint}</p>
      <button type="button" className="action-secondary" onClick={() => void attach()}>
        {copy.button}
      </button>
      {status === 'failed' && <p className="ingest-problem">{copy.failed}</p>}
    </div>
  );
}
