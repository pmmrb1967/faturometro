import { useState, type CSSProperties } from 'react';
import { t } from '../../i18n/pt-PT';
import type { PageText } from '../../pdf/text';
import type { FiscalQr } from '../../qr/parse';
import { ContributionError, sendContribution } from './send';
import {
  buildDraft,
  renderContribution,
  setMasked,
  type ContributionContext,
  type Draft,
  type DraftItem,
} from './skeleton';
import { VOCABULARY } from './vocabulary';
import './contribute.css';

const copy = t.contribute;

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; text: string };

/** Preview of exactly what leaves the browser, word masking, consent and sending. */
export function ContributePanel({
  pages,
  qrs,
  personal,
  context,
  onClose,
}: {
  pages: PageText[];
  qrs: FiscalQr[];
  personal: string[];
  context: ContributionContext;
  onClose?: () => void;
}) {
  // Built once: the originals stay in this component's memory only.
  const [draft, setDraft] = useState<Draft>(() => buildDraft({ pages, qrs, personal, context }));
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  if (status.kind === 'sent') return <p role="status">{copy.sent}</p>;

  async function send() {
    setStatus({ kind: 'sending' });
    try {
      await sendContribution(renderContribution(draft));
      setStatus({ kind: 'sent' });
    } catch (error) {
      const code = error instanceof ContributionError ? error.code : 'failed';
      setStatus({ kind: 'error', text: copy.errors[code] });
    }
  }

  const toggle = (key: string) => {
    const word = draft.words[key];
    if (word) setDraft(setMasked(draft, key, !word.masked));
  };

  return (
    <section className="contribute" aria-labelledby="contribute-title">
      <h3 id="contribute-title">{copy.title}</h3>
      <p>{copy.intro}</p>
      <p className="ingest-problem">{copy.warning}</p>
      {draft.pages.map((page) => (
        <div
          key={page.page}
          className="contribute-page"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
        >
          {page.items.map((item, index) => (
            <Item
              key={index}
              item={item}
              pageWidth={page.width}
              pageHeight={page.height}
              draft={draft}
              onToggle={toggle}
            />
          ))}
        </div>
      ))}
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        {copy.consent}
      </label>
      {status.kind === 'error' && (
        <p className="ingest-problem" role="alert">
          {status.text}
        </p>
      )}
      <div className="ingest-actions">
        <button
          type="button"
          className="action-primary"
          disabled={!consent || status.kind === 'sending'}
          onClick={() => void send()}
        >
          {status.kind === 'sending' ? copy.sending : copy.send}
        </button>
        {onClose && (
          <button type="button" className="action-secondary" onClick={onClose}>
            {copy.cancel}
          </button>
        )}
      </div>
    </section>
  );
}

function Item({
  item,
  pageWidth,
  pageHeight,
  draft,
  onToggle,
}: {
  item: DraftItem;
  pageWidth: number;
  pageHeight: number;
  draft: Draft;
  onToggle: (key: string) => void;
}) {
  const style: CSSProperties = {
    left: `${(item.x / pageWidth) * 100}%`,
    top: `${(item.y / pageHeight) * 100}%`,
    fontSize: `calc(100cqw * ${item.height / pageWidth})`,
  };
  return (
    <span className="contribute-item" style={style}>
      {item.tokens.map((token, index) => {
        if (token.kind !== 'word') return token.text;
        const word = draft.words[token.key];
        if (!word) return token.shape;
        if (!word.masked && VOCABULARY.has(token.key)) return token.original;
        return (
          <button
            key={index}
            type="button"
            className={word.masked ? 'contribute-word masked' : 'contribute-word'}
            disabled={word.locked}
            title={word.locked ? copy.locked : undefined}
            onClick={() => onToggle(token.key)}
          >
            {word.masked ? token.shape : token.original}
          </button>
        );
      })}
    </span>
  );
}
