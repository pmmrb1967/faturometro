import { useRef, useState, type ChangeEvent } from 'react';
import { monthOf } from '../../domain/month';
import { t } from '../../i18n/pt-PT';
import type { FoundQr } from '../../qr/scan';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { canUseLiveCamera } from '../spending/camera';
import { LiveReceiptScanner } from '../spending/LiveReceiptScanner';
import { readReceipt, type TransactionDraft } from '../spending/receipt';
import { SpendingHelp } from '../spending/SpendingHelp';
import { TransactionForm } from '../spending/TransactionForm';
import { saveOneOff } from './one-off-save';

const copy = t.spending;

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
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
  withReceipts,
  onMonth,
}: {
  month: string;
  /** Receipts and day-to-day purchases (Definições, "Gastos"). */
  withReceipts: boolean;
  onMonth: (month: string) => void;
}) {
  const { session } = useSession();
  const [editing, setEditing] = useState<TransactionDraft | null>(null);
  /** The photo or PDF the purchase being added was read from. */
  const [readFile, setReadFile] = useState<File | null>(null);
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
      category: withReceipts ? 'food' : 'home',
      description: '',
      source: 'manual',
    };
  }

  function startNew() {
    setNotice(null);
    setReadFile(null);
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
    await showReceipt(
      async () => {
        // pdf.js and zxing are loaded only when a receipt is read.
        const { readImage, readPdf } = await import('../../pdf/browser');
        const bytes = new Uint8Array(await file.arrayBuffer());
        return isPdf(file) ? (await readPdf(bytes)).qrs : readImage(bytes, file.type);
      },
      keep ? file : null,
    );
  }

  async function showReceipt(read: () => Promise<FoundQr[]>, file: File | null = null) {
    setNotice(null);
    setReadFile(file);
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
        setEditing(outcome.draft);
      } else if (outcome.kind === 'invoice') {
        problem(copy.receipt.invoice);
      } else if (outcome.kind === 'known') {
        problem(copy.receipt.known);
      } else {
        problem(copy.receipt.noQr);
        setEditing(newDraft());
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
      <p className="muted">{withReceipts ? t.month.oneOff.intro : t.month.oneOff.introBasic}</p>
      <div className="month-actions">
        <button type="button" className="action-primary" onClick={startNew}>
          {withReceipts ? copy.add : t.month.oneOff.add}
        </button>
        {withReceipts && (
          <button type="button" className="action-secondary" disabled={reading} onClick={startScan}>
            {copy.scan}
          </button>
        )}
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
      {withReceipts && <p className="muted spending-hint">{copy.scanHint}</p>}
      <SpendingHelp />

      {reading && <p role="status">{copy.receipt.reading}</p>}
      {notice?.month === month && (
        <p role="status" className={notice.problem ? 'ingest-problem' : 'doc-saved'}>
          {notice.text}
        </p>
      )}
      {editing && (
        <TransactionForm
          key={editing.id}
          initial={editing}
          {...(readFile ? { file: readFile } : {})}
          onDone={async (draft, warranty) => {
            if (!draft) {
              setEditing(null);
              setReadFile(null);
              setNotice(null);
              return;
            }
            await saveOneOff(repos, draft, warranty, undefined);
            setEditing(null);
            setReadFile(null);
            // An old receipt is shown where it landed.
            setNotice({ text: copy.saved, month: monthOf(draft.date) });
            onMonth(monthOf(draft.date));
          }}
        />
      )}
    </>
  );
}
