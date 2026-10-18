import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { invoiceSource } from '../../ai/document';
import { estimateProposal } from '../../ai/estimate';
import { findModel, formatMicroUsd } from '../../ai/models';
import type { ProposalReading } from '../../ai/prompts/proposal';
import { AiError, type AiUsage, type InvoiceSource } from '../../ai/provider';
import { aiAvailable, aiModelOf, providerFromSettings, recordUsage } from '../../ai/session';
import { isGuest } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { aiErrorText } from '../ai/errors';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import '../ingest/ingest.css';

const copy = t.insurance.proposals.ai;

interface Prepared {
  source: InvoiceSource;
  pages: number;
}

/**
 * Reads a proposal's PDF (or photo) with the AI, after showing what will be
 * sent and the estimated cost, and hands the reading to the form for review.
 * Without a key the form is filled by hand (CLAUDE.md rule 4).
 */
export function ProposalReader({
  coverages,
  onRead,
}: {
  coverages: string[];
  onRead: (reading: ProposalReading) => void;
}) {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  const [prepared, setPrepared] = useState<Prepared>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState<ProposalReading>();
  const fileInput = useRef<HTMLInputElement>(null);

  if (!settings || !session) return null;
  if (!aiAvailable(session.profile, settings)) {
    return (
      <p className="muted">{isGuest(session.profile) ? t.guest.aiNeedsAccount : copy.noKey}</p>
    );
  }

  async function send(next: Prepared) {
    if (!session) return;
    const provider = providerFromSettings(await getSettings(session.repos));
    if (!provider) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const result = await provider.readProposal(next.source, coverages);
      await recordUsage(session.repos, result.usage);
      setPrepared(undefined);
      setDone(result.reading);
      onRead(result.reading);
    } catch (error) {
      const usage = (error as { usage?: AiUsage[] }).usage;
      if (usage) await recordUsage(session.repos, usage);
      setProblem(aiErrorText(error instanceof AiError ? error.code : 'unavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(undefined);
    setDone(undefined);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    let next: Prepared | undefined;
    if (pdf) {
      try {
        const { readPdfText } = await import('../../pdf/browser');
        const { pages, pageCount } = await readPdfText(bytes);
        const source = invoiceSource({
          pages,
          bytes,
          mime: 'application/pdf',
          fileKind: 'pdf',
          protectedPdf: false,
        });
        if (source) next = { source, pages: pageCount };
      } catch {
        setProblem(copy.unreadable);
        return;
      }
    } else {
      const source = invoiceSource({
        pages: [],
        bytes,
        mime: file.type,
        fileKind: 'image',
        protectedPdf: false,
      });
      if (source) next = { source, pages: 1 };
    }
    if (!next) {
      setProblem(copy.cannotSend);
      return;
    }
    if (settings?.aiAutoSend) {
      await send(next);
    } else {
      setPrepared(next);
    }
  }

  const model = aiModelOf(settings);
  const estimate = prepared && estimateProposal(model, prepared.source, prepared.pages);
  return (
    <div className="ai-panel proposal-reader">
      <button
        type="button"
        className="action-secondary"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        {busy ? copy.sending : copy.choose}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => void choose(event)}
      />
      <p className="muted">{copy.intro}</p>
      {prepared && estimate && (
        <>
          <p className="muted">
            {t.ai.extract.willSend}{' '}
            {prepared.source.kind === 'text'
              ? copy.sendText(prepared.source.text.length)
              : prepared.source.kind === 'pdf'
                ? copy.sendPdf
                : copy.sendImage}
            . {t.ai.extract.model(findModel(model).label)}{' '}
            {t.ai.extract.cost(formatMicroUsd(estimate.costMicroUsd))}
          </p>
          {prepared.source.kind === 'text' && (
            <details className="ai-sent">
              <summary>{t.ai.extract.showText}</summary>
              <pre>{prepared.source.text}</pre>
            </details>
          )}
          <div className="proposal-actions">
            <button
              type="button"
              className="action-primary"
              disabled={busy}
              onClick={() => void send(prepared)}
            >
              {busy ? copy.sending : copy.send}
            </button>
            <button
              type="button"
              className="action-secondary"
              disabled={busy}
              onClick={() => setPrepared(undefined)}
            >
              {t.insurance.proposals.cancel}
            </button>
          </div>
        </>
      )}
      {problem && (
        <p className="ingest-problem" role="alert">
          {problem}
        </p>
      )}
      {done && (
        <div role="status">
          <p>{copy.done}</p>
          {done.extra.length > 0 && <p className="muted">{copy.extra(done.extra.join(', '))}</p>}
        </div>
      )}
    </div>
  );
}
