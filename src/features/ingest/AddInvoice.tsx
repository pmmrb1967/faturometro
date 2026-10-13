import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { vatCents } from '../../qr/parse';
import { isValidNif } from '../../domain/nif';
import { useSession } from '../auth/session-context';
import { getSettings, updateSettings } from '../settings/settings';
import { browserIngestDeps } from './browser-deps';
import { ingestFile, type IngestOutcome, type ReadQr } from './ingest';
import { emptyForm, formFromQr, type FormBase } from '../invoices/form';
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

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await read({ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type });
  }

  return (
    <section className="ingest" aria-labelledby="ingest-title">
      <h2 id="ingest-title">{copy.title}</h2>

      {state.step === 'idle' && (
        <>
          <p className="muted">{copy.intro}</p>
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
        hidden
        onChange={(event) => void onFile(event)}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => void onFile(event)}
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
      <input
        id="pdf-password"
        type="password"
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
  if (outcome.kind === 'unsupported') return <p className="ingest-problem">{copy.unsupported}</p>;
  if (outcome.kind === 'duplicate_file') {
    return <p className="ingest-problem">{copy.duplicateFile}</p>;
  }
  if (outcome.kind !== 'read') return null;

  const stored = { fileHash: outcome.fileHash, mime: outcome.mime, bytes: file.bytes };
  const done = (index: number) => (saved: boolean) =>
    setStatus((current) => ({ ...current, [index]: saved ? 'saved' : 'skipped' }));

  if (outcome.qrStatus !== 'ok') {
    if (status[0])
      return status[0] === 'saved' ? <p role="status">{t.invoices.review.saved}</p> : null;
    return (
      <>
        <p className="ingest-problem">
          {outcome.qrStatus === 'missing' ? copy.noQr : copy.invalidQr}
        </p>
        <ReviewForm
          base={{ fileHash: outcome.fileHash, file: stored }}
          initial={emptyForm()}
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
        const { form, locked } = formFromQr(qr.result.qr);
        const docType = qr.result.qr.docType;
        const label = [docType ? (copy.docTypes[docType] ?? docType) : '', qr.result.qr.docId]
          .filter(Boolean)
          .join(' ');
        const base: FormBase = { fileHash: outcome.fileHash, file: stored, qr: qr.result.qr };
        if (qr.docKey) base.docKey = qr.docKey;
        return (
          <ReviewForm
            key={index}
            base={base}
            initial={form}
            locked={locked}
            title={
              total > 1 ? `${index + 1}/${total} · ${label}` : label || t.invoices.review.title
            }
            intro={t.invoices.review.fromQr}
            onDone={done(index)}
          />
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
