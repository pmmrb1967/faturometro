import { useState } from 'react';
import { t } from '../../i18n/pt-PT';
import type { PageText } from '../../pdf/text';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { useSession } from '../auth/session-context';
import { browserIngestDeps } from '../ingest/browser-deps';
import { readPdfWithPasswords, runParser, type ParsedDocument } from '../ingest/ingest';
import { getSettings } from '../settings/settings';
import { ContributePanel } from './ContributePanel';
import { personalValues } from './eligible';

const copy = t.contribute;

interface Loaded {
  pages: PageText[];
  qrs: FiscalQr[];
  parsed?: ParsedDocument;
  personal: string[];
}

/** From the invoice list: reads the stored original PDF again, then shows the preview. */
export function ContributeFromOriginal({ fileHash }: { fileHash: string }) {
  const { session } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  if (!session) return null;

  async function load() {
    if (!session) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const file = await session.repos.documents.getByFileHash(fileHash);
      if (!file) throw new Error('No original');
      if (file.mime !== 'application/pdf') {
        setProblem(copy.notPdf);
        return;
      }
      const settings = await getSettings(session.repos);
      const read = await readPdfWithPasswords(
        new Uint8Array(file.bytes),
        settings.ownNif ? [settings.ownNif] : [],
        browserIngestDeps(session.repos),
      );
      if (!read.ok) throw new Error('Unreadable');
      if (!read.pages.some((page) => page.items.length > 0)) {
        setProblem(copy.notPdf);
        return;
      }
      const qrs = read.qrs.flatMap(({ text }) => {
        const result = parseFiscalQr(text);
        return result.ok ? [result.qr] : [];
      });
      const parsed = runParser(read.pages, qrs, qrs[0]);
      setLoaded({
        pages: read.pages,
        qrs,
        ...(parsed ? { parsed } : {}),
        personal: personalValues({
          qrs,
          ...(parsed ? { extraction: parsed.extraction } : {}),
          ...(settings.ownNif ? { ownNif: settings.ownNif } : {}),
        }),
      });
    } catch {
      setProblem(copy.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (loaded) {
    return (
      <ContributePanel
        pages={loaded.pages}
        qrs={loaded.qrs}
        personal={loaded.personal}
        context={{
          pages: loaded.pages.length,
          ...(loaded.parsed
            ? {
                parserId: loaded.parsed.parserId,
                parserVersion: loaded.parsed.parserVersion,
                failures: loaded.parsed.check.failures,
              }
            : {}),
        }}
        onClose={() => setLoaded(null)}
      />
    );
  }

  return (
    <span className="original">
      <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>
        {copy.open}
      </button>
      {problem && (
        <span className="original-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
