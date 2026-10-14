import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { onOpenedFiles, takeOpenedFiles } from '../../app/opened-files';
import { countSharedFiles, takeSharedFile } from '../../app/shared-files';
import { PasswordInput } from '../../components/Field';
import { invoiceSource } from '../../ai/document';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { vatCents } from '../../qr/parse';
import { isValidNif } from '../../domain/nif';
import { useSession } from '../auth/session-context';
import { getSettings, updateSettings } from '../settings/settings';
import { browserIngestDeps } from './browser-deps';
import { ContributeOffer } from '../contribute/ContributeOffer';
import { shouldOffer } from '../contribute/eligible';
import { AiExtractPanel } from '../ai/AiExtractPanel';
import { ingestFile, type IngestOutcome, type ParsedDocument, type ReadQr } from './ingest';
import { emptyForm, formFromParsed, formFromQr, type FormBase } from '../invoices/form';
import { ReviewForm } from '../invoices/ReviewForm';
import './ingest.css';

const copy = t.ingest;

type State =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'password'; file: PendingFile; reason: 'needed' | 'incorrect' }
  | { step: 'done'; outcome: IngestOutcome; file: PendingFile }
  | { step: 'manual'; fileHash: string }
  | { step: 'error' };

interface PendingFile {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

export function AddInvoice() {
  const { session } = useSession();
  const [state, setState] = useState<State>({ step: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  /** Files received with "Share → Faturómetro" still waiting to be read. */
  const [sharedLeft, setSharedLeft] = useState(0);
  /** Files chosen, dropped or opened with the app, in memory, waiting to be read. */
  const [queue, setQueue] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const left = queue.length + sharedLeft;

  async function readFile(file: File) {
    await read({ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type });
  }

  /** The next waiting file: chosen or dropped first, then shared ones. */
  async function readNext() {
    const [next, ...rest] = queue;
    if (next) {
      setQueue(rest);
      await readFile(next);
      return;
    }
    const shared = await takeSharedFile();
    setSharedLeft(await countSharedFiles());
    if (shared) await read({ bytes: shared.bytes, mime: shared.mime });
  }

  /** Reads the first file now if nothing is on screen; the rest wait for "next". */
  function enqueue(files: File[]) {
    if (files.length === 0) return;
    if (state.step === 'idle') {
      const [first, ...rest] = files;
      setQueue((current) => [...current, ...rest]);
      if (first) void readFile(first);
    } else {
      setQueue((current) => [...current, ...files]);
    }
  }

  // Files shared from another app or opened with the app are read as soon as the page opens.
  const hasSession = Boolean(session);
  useEffect(() => {
    if (!hasSession) return;
    // After this render, not inside it.
    const timer = window.setTimeout(() => {
      const opened = takeOpenedFiles();
      if (opened.length > 0) enqueue(opened);
      else void readNext();
    }, 0);
    const stop = onOpenedFiles(() => setQueue((current) => [...current, ...takeOpenedFiles()]));
    return () => {
      window.clearTimeout(timer);
      stop();
    };
    // Once per visit, when the account is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession]);

  if (!session) return null;
  const { repos } = session;

  async function read(file: PendingFile, typedPassword?: string, remember = false) {
    setState({ step: 'reading' });
    try {
      const settings = await getSettings(repos);
      const passwords = [settings.ownNif, typedPassword].filter((password): password is string =>
        Boolean(password),
      );
      const outcome = await ingestFile(file, browserIngestDeps(repos), passwords);
      if (outcome.kind === 'needs_password') {
        setState({
          step: 'password',
          file,
          reason: typedPassword === undefined ? 'needed' : 'incorrect',
        });
        return;
      }
      if (remember && outcome.kind === 'read' && outcome.usedPassword === typedPassword) {
        await updateSettings(repos, { ownNif: typedPassword });
      }
      setState({ step: 'done', outcome, file });
    } catch {
      setState({ step: 'error' });
    }
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    enqueue(files);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    enqueue([...event.dataTransfer.files]);
  }

  return (
    <section
      className={dragging ? 'ingest is-dragging' : 'ingest'}
      aria-labelledby="ingest-title"
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <h2 id="ingest-title">{copy.title}</h2>
      {dragging && (
        <p className="ingest-drop" aria-hidden="true">
          {copy.dropHere}
        </p>
      )}

      {state.step === 'idle' && (
        <>
          <p className="muted">{copy.intro}</p>
          <p className="muted ingest-drop-hint">{copy.dropHint}</p>
          <div className="ingest-actions">
            <button
              type="button"
              className="action-primary"
              onClick={() => fileInput.current?.click()}
            >
              {copy.chooseFile}
            </button>
            <button
              type="button"
              className="action-secondary"
              onClick={() => photoInput.current?.click()}
            >
              {copy.takePhoto}
            </button>
            <button
              type="button"
              className="action-secondary"
              onClick={() =>
                setState({ step: 'manual', fileHash: `manual:${crypto.randomUUID()}` })
              }
            >
              {t.invoices.review.manual}
            </button>
          </div>
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={onFiles}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFiles}
      />

      {state.step === 'reading' && (
        <p className="ingest-status" role="status">
          {copy.reading}
        </p>
      )}

      {state.step === 'password' && (
        <PasswordForm
          reason={state.reason}
          onSubmit={(password, remember) => void read(state.file, password, remember)}
          onCancel={() => setState({ step: 'idle' })}
        />
      )}

      {state.step === 'error' && <p className="ingest-problem">{copy.failed}</p>}
      {state.step === 'done' && <Outcome outcome={state.outcome} file={state.file} />}
      {state.step === 'manual' && (
        <ReviewForm
          base={{ fileHash: state.fileHash }}
          initial={emptyForm()}
          title={t.invoices.review.manualTitle}
          intro={t.invoices.review.manualIntro}
          onDone={() => setState({ step: 'idle' })}
        />
      )}

      {left > 0 && state.step !== 'reading' && (
        <button type="button" className="action-primary" onClick={() => void readNext()}>
          {copy.nextFile(left)}
        </button>
      )}

      {(state.step === 'done' || state.step === 'error') && (
        <button
          type="button"
          className="action-secondary"
          onClick={() => setState({ step: 'idle' })}
        >
          {copy.another}
        </button>
      )}
    </section>
  );
}

function PasswordForm({
  reason,
  onSubmit,
  onCancel,
}: {
  reason: 'needed' | 'incorrect';
  onSubmit: (password: string, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const looksLikeNif = isValidNif(password.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) onSubmit(password.trim(), remember && looksLikeNif);
  }

  return (
    <form className="ingest-password" onSubmit={submit}>
      <h3>{copy.password.title}</h3>
      <p className={reason === 'incorrect' ? 'ingest-problem' : 'muted'}>
        {reason === 'incorrect' ? copy.password.incorrect : copy.password.needed}
      </p>
      <label htmlFor="pdf-password">{copy.password.label}</label>
      <PasswordInput
        id="pdf-password"
        autoComplete="off"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
      />
      {looksLikeNif && (
        <label className="ingest-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          {copy.password.remember}
        </label>
      )}
      <div className="ingest-actions">
        <button type="submit" className="action-primary" disabled={!password}>
          {copy.password.submit}
        </button>
        <button type="button" className="action-secondary" onClick={onCancel}>
          {copy.password.cancel}
        </button>
      </div>
    </form>
  );
}

type DocStatus = 'saved' | 'skipped';

function Outcome({ outcome, file }: { outcome: IngestOutcome; file: PendingFile }) {
  const [status, setStatus] = useState<Record<number, DocStatus>>({});
  /** What the AI read, per document, when no parser knew the layout. */
  const [aiParsed, setAiParsed] = useState<Record<number, ParsedDocument>>({});
  if (outcome.kind === 'unsupported') return <p className="ingest-problem">{copy.unsupported}</p>;
  if (outcome.kind === 'duplicate_file') {
    return <p className="ingest-problem">{copy.duplicateFile}</p>;
  }
  if (outcome.kind !== 'read') return null;

  const stored = { fileHash: outcome.fileHash, mime: outcome.mime, bytes: file.bytes };
  const source = invoiceSource({
    pages: outcome.pages,
    bytes: file.bytes,
    mime: outcome.mime,
    fileKind: outcome.fileKind,
    protectedPdf: Boolean(outcome.usedPassword),
  });
  const pdfPages = Math.max(1, outcome.pages.length);
  const aiDone = (index: number) => (parsed: ParsedDocument) =>
    setAiParsed((current) => ({ ...current, [index]: parsed }));
  const done = (index: number) => (saved: boolean) =>
    setStatus((current) => ({ ...current, [index]: saved ? 'saved' : 'skipped' }));

  const parsedQrs = outcome.qrs.flatMap((qr) => (qr.result.ok ? [qr.result.qr] : []));
  // What a layout parser (not the AI) read: decides whether the layout is known.
  const byParser = outcome.qrs.find((qr) => qr.parsed)?.parsed ?? outcome.parsed;
  const contribute = shouldOffer({
    fileKind: outcome.fileKind,
    hasText: outcome.pages.some((page) => page.items.length > 0),
    ...(byParser ? { parserId: byParser.parserId, validation: byParser.check.validation } : {}),
  }) ? (
    <ContributeOffer
      pages={outcome.pages}
      qrs={parsedQrs}
      {...(byParser ? { parsed: byParser } : {})}
      extra={Object.values(aiParsed)}
    />
  ) : null;

  if (outcome.qrStatus !== 'ok') {
    if (status[0])
      return status[0] === 'saved' ? <p role="status">{t.invoices.review.saved}</p> : null;
    const parsed = outcome.parsed ?? aiParsed[0];
    return (
      <>
        <p className="ingest-problem">
          {outcome.qrStatus === 'missing' ? copy.noQr : copy.invalidQr}
        </p>
        {contribute}
        {!parsed && <AiExtractPanel source={source} pdfPages={pdfPages} onResult={aiDone(0)} />}
        {aiParsed[0] && <p role="status">{t.ai.extract.done}</p>}
        <ReviewForm
          key={parsed ? parsed.parserId : 'manual'}
          base={{
            fileHash: outcome.fileHash,
            file: stored,
            ...(parsed ? { parsed } : {}),
          }}
          initial={parsed ? formFromParsed(parsed) : emptyForm()}
          title={t.invoices.review.manualTitle}
          intro={t.invoices.review.manualIntro}
          onDone={done(0)}
        />
      </>
    );
  }

  const total = outcome.qrs.length;
  return (
    <div className="ingest-result">
      <p role="status">{copy.foundCount(total)}</p>
      {contribute}
      {outcome.qrs.map((qr, index) => {
        if (status[index] === 'skipped') return null;
        if (status[index] === 'saved') {
          return (
            <p key={index} role="status" className="doc-saved">
              {t.invoices.review.saved}
            </p>
          );
        }
        if (!qr.result.ok) {
          return (
            <p key={index} className="ingest-problem">
              {copy.invalidQr}
            </p>
          );
        }
        if (qr.duplicateInvoiceId) return <QrCard key={index} qr={qr} />;
        const parsed = qr.parsed ?? aiParsed[index];
        const { form, locked } = formFromQr(qr.result.qr, parsed);
        const docType = qr.result.qr.docType;
        const sector = parsed?.extraction.sector;
        const label = [
          sector ? t.sectors[sector] : '',
          [docType ? (copy.docTypes[docType] ?? docType) : '', qr.result.qr.docId]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(' · ');
        const base: FormBase = { fileHash: outcome.fileHash, file: stored, qr: qr.result.qr };
        if (qr.docKey) base.docKey = qr.docKey;
        if (parsed) base.parsed = parsed;
        return (
          <div key={index}>
            {!parsed && (
              <AiExtractPanel
                source={source}
                pdfPages={pdfPages}
                {...(total > 1 && qr.result.qr.docId
                  ? {
                      target: {
                        docId: qr.result.qr.docId,
                        totalCents: qr.result.qr.totalCents,
                      },
                    }
                  : {})}
                qr={qr.result.qr}
                onResult={aiDone(index)}
              />
            )}
            {aiParsed[index] && <p role="status">{t.ai.extract.done}</p>}
            <ReviewForm
              key={parsed ? parsed.parserId : 'qr'}
              base={base}
              initial={form}
              locked={locked}
              title={
                total > 1 ? `${index + 1}/${total} · ${label}` : label || t.invoices.review.title
              }
              intro={t.invoices.review.fromQr}
              onDone={done(index)}
            />
          </div>
        );
      })}
    </div>
  );
}

function QrCard({ qr }: { qr: ReadQr }) {
  if (!qr.result.ok) return <p className="ingest-problem">{copy.invalidQr}</p>;
  const data = qr.result.qr;
  const fields = copy.fields;
  const docType = data.docType ? (copy.docTypes[data.docType] ?? data.docType) : '—';
  return (
    <article className="doc-card">
      {qr.duplicateInvoiceId && <p className="doc-duplicate">{copy.duplicateInvoice}</p>}
      <dl>
        <div>
          <dt>{fields.issuer}</dt>
          <dd>{data.issuerNif}</dd>
        </div>
        <div>
          <dt>{fields.docType}</dt>
          <dd>{docType}</dd>
        </div>
        {data.docId && (
          <div>
            <dt>{fields.docId}</dt>
            <dd>{data.docId}</dd>
          </div>
        )}
        <div>
          <dt>{fields.date}</dt>
          <dd>{formatIsoDate(data.date)}</dd>
        </div>
        <div>
          <dt>{fields.vat}</dt>
          <dd>{formatCents(vatCents(data))}</dd>
        </div>
        <div className="doc-total">
          <dt>{fields.total}</dt>
          <dd>{formatCents(data.totalCents)}</dd>
        </div>
      </dl>
    </article>
  );
}
