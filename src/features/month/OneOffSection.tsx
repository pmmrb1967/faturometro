import { useRef, useState, type ChangeEvent } from 'react';
import { documentText, invoiceSource } from '../../ai/document';
import type { InvoiceSource } from '../../ai/provider';
import { monthOf } from '../../domain/month';
import { productFromLines, storeFromText } from '../../domain/purchase-reading';
import { t } from '../../i18n/pt-PT';
import type { FoundQr } from '../../qr/scan';
import { today } from '../alerts/refresh';
import { AiExtractPanel } from '../ai/AiExtractPanel';
import { useSession } from '../auth/session-context';
import { canUseLiveCamera } from '../spending/camera';
import { LiveReceiptScanner } from '../spending/LiveReceiptScanner';
import { readReceipt, type TransactionDraft } from '../spending/receipt';
import { SpendingHelp } from '../spending/SpendingHelp';
import { TransactionForm, type PurchaseSuggestion } from '../spending/TransactionForm';
import { saveOneOff } from './one-off-save';

const copy = t.spending;

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/** The photo or PDF a purchase was read from: kept with its warranty, and what the AI may read. */
interface ReadFile {
  file: File;
  /** Undefined when it cannot be sent (protected PDF, image the AI does not read). */
  source: InvoiceSource | undefined;
  pdfPages: number;
}

/** Shown only in the month it is about, so it goes away with the arrows. */
type Notice = { text: string; month: string; problem?: boolean };

/**
 * Adding a one-off expense: typed, or read from the QR code of a receipt
 * (with the purchases of every day turned on). Changing one is done in its
 * line of the month.
 */
export function OneOffSection({
  month,
  onMonth,
}: {
  month: string;
  onMonth: (month: string) => void;
}) {
  const { session } = useSession();
  const [editing, setEditing] = useState<TransactionDraft | null>(null);
  /** The photo or PDF the purchase being added was read from. */
  const [readFile, setReadFile] = useState<ReadFile | null>(null);
  /** What the file says beyond its QR code (the store; with AI, the product too). */
  const [suggestion, setSuggestion] = useState<PurchaseSuggestion>({});
  const [reading, setReading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shownMonth, setShownMonth] = useState(month);
  if (month !== shownMonth) {
    setShownMonth(month);
    setEditing(null);
  }
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!session) return null;
  const repos = session.repos;

  function newDraft(): TransactionDraft {
    const now = today();
    return {
      id: crypto.randomUUID(),
      date: monthOf(now) === month ? now : `${month}-01`,
      amountCents: 0,
      category: 'other',
      description: '',
      source: 'manual',
    };
  }

  function startNew() {
    setNotice(null);
    setReadFile(null);
    setSuggestion({});
    setEditing(newDraft());
  }

  function startScan() {
    setNotice(null);
    if (canUseLiveCamera()) setScanning(true);
    else photoInput.current?.click();
  }

  function scanByPhoto() {
    setScanning(false);
    photoInput.current?.click();
  }

  /** A photo from the camera, or a photo or PDF chosen from the device (kept for the warranty). */
  async function onFile(event: ChangeEvent<HTMLInputElement>, keep: boolean) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let store = '';
    await showReceipt(
      async () => {
        // pdf.js and zxing are loaded only when a receipt is read.
        const { readImage, readPdf } = await import('../../pdf/browser');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdf = isPdf(file);
        let pages: Awaited<ReturnType<typeof readPdf>>['pages'] = [];
        let qrs: FoundQr[];
        let protectedPdf = false;
        if (pdf) {
          try {
            ({ pages, qrs } = await readPdf(bytes));
          } catch {
            // A PDF with a password: kept, but neither read here nor sent.
            protectedPdf = true;
            qrs = [];
          }
        } else {
          qrs = await readImage(bytes, file.type);
        }
        if (keep) {
          store = storeFromText(documentText(pages));
          setReadFile({
            file,
            source: invoiceSource({
              pages,
              bytes,
              mime: file.type,
              fileKind: pdf ? 'pdf' : 'image',
              protectedPdf,
            }),
            pdfPages: Math.max(1, pages.length),
          });
          setSuggestion(store ? { seller: store } : {});
        }
        return qrs;
      },
      () => store,
    );
  }

  /** `store`: the store's name read from the file, once it was read. */
  async function showReceipt(read: () => Promise<FoundQr[]>, store: () => string = () => '') {
    setNotice(null);
    setReadFile(null);
    setSuggestion({});
    setEditing(null);
    setReading(true);
    const problem = (text: string) => setNotice({ text, month, problem: true });
    try {
      const outcome = await readReceipt(await read(), {
        findInvoiceIdByDocKey: async (docKey) =>
          (await repos.invoices.findBy('docKey', docKey))[0]?.id,
        getTransaction: (id) => repos.transactions.get(id),
        listTransactions: () => repos.transactions.list(),
        issuerName: async (nif) => (await repos.providers.findBy('nif', nif))[0]?.name,
      });
      if (outcome.kind === 'read') {
        setNotice({ text: copy.receipt.read, month });
        setEditing({
          ...outcome.draft,
          description: outcome.draft.description || store(),
        });
      } else if (outcome.kind === 'invoice') {
        problem(copy.receipt.invoice);
      } else if (outcome.kind === 'known') {
        problem(copy.receipt.known);
      } else {
        problem(copy.receipt.noQr);
        setEditing({ ...newDraft(), description: store() });
      }
    } catch {
      problem(copy.receipt.noQr);
      setEditing(newDraft());
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <p className="muted">{t.month.oneOff.intro}</p>
      <div className="month-actions">
        <button type="button" className="action-primary" onClick={startNew}>
          {copy.add}
        </button>
        <button type="button" className="action-secondary" disabled={reading} onClick={startScan}>
          {copy.scan}
        </button>
        <button
          type="button"
          className="action-secondary"
          disabled={reading}
          onClick={() => {
            setNotice(null);
            fileInput.current?.click();
          }}
        >
          {copy.pickFile}
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void onFile(event, false)}
        />
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={(event) => void onFile(event, true)}
        />
      </div>
      {scanning && (
        <LiveReceiptScanner
          onFound={(found) => {
            setScanning(false);
            void showReceipt(async () => found);
          }}
          onPhoto={scanByPhoto}
          onClose={() => setScanning(false)}
        />
      )}
      <p className="muted spending-hint">{copy.scanHint}</p>
      <SpendingHelp />

      {reading && <p role="status">{copy.receipt.reading}</p>}
      {notice?.month === month && (
        <p role="status" className={notice.problem ? 'ingest-problem' : 'doc-saved'}>
          {notice.text}
        </p>
      )}
      {editing && readFile && !suggestion.product && (
        <AiExtractPanel
          source={readFile.source}
          pdfPages={readFile.pdfPages}
          intro={t.month.oneOff.aiIntro}
          unavailable={t.month.oneOff.aiOff}
          onResult={(parsed) => {
            const seller = parsed.providerName || parsed.extraction.issuerName?.value || '';
            const product = productFromLines(parsed.extraction.lines);
            setSuggestion((previous) => ({
              ...previous,
              ...(seller ? { seller } : {}),
              ...(product ? { product } : {}),
            }));
            setNotice({
              text: product ? t.month.oneOff.aiDone : t.month.oneOff.aiNothing,
              month,
              problem: !product,
            });
          }}
        />
      )}
      {editing && (
        <TransactionForm
          key={editing.id}
          initial={editing}
          suggestion={suggestion}
          {...(readFile ? { file: readFile.file } : {})}
          onDone={async (draft, warranty) => {
            if (!draft) {
              setEditing(null);
              setReadFile(null);
              setSuggestion({});
              setNotice(null);
              return;
            }
            await saveOneOff(repos, draft, warranty, undefined);
            setEditing(null);
            setReadFile(null);
            setSuggestion({});
            // An old receipt is shown where it landed.
            setNotice({ text: copy.saved, month: monthOf(draft.date) });
            onMonth(monthOf(draft.date));
          }}
        />
      )}
    </>
  );
}
