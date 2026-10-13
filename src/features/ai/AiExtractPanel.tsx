import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { estimateExtraction } from '../../ai/estimate';
import { findModel, formatMicroUsd } from '../../ai/models';
import {
  AI_PARSER_PREFIX,
  EXTRACT_PROMPT_VERSION,
  type DocumentTarget,
} from '../../ai/prompts/extract';
import { AiError, type AiUsage, type InvoiceSource } from '../../ai/provider';
import { aiModelOf, providerFromSettings, recordUsage } from '../../ai/session';
import { t } from '../../i18n/pt-PT';
import type { FiscalQr } from '../../qr/parse';
import { useSession } from '../auth/session-context';
import type { ParsedDocument } from '../ingest/ingest';
import { validateExtraction } from '../ingest/validate';
import { getSettings } from '../settings/settings';
import { aiErrorText } from './errors';

const copy = t.ai.extract;

interface Props {
  /** Undefined when this file cannot be sent (protected scan, unsupported image). */
  source: InvoiceSource | undefined;
  pdfPages: number;
  /** With several invoices in one file: which one. */
  target?: DocumentTarget;
  qr?: FiscalQr;
  onResult: (parsed: ParsedDocument) => void;
}

/**
 * Step 6 of the pipeline (PLAN.md §6): AI extraction of an invoice no parser
 * knows, after showing what will be sent and the estimated cost (unless the
 * user turned on automatic sending). The result goes through the same QR
 * cross-validation as the parsers.
 */
export function AiExtractPanel({ source, pdfPages, target, qr, onResult }: Props) {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);

  async function send() {
    if (!session || !source || started.current) return;
    const provider = providerFromSettings(await getSettings(session.repos));
    if (!provider) return;
    started.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const result = await provider.extract(source, target);
      await recordUsage(session.repos, result.usage);
      onResult({
        parserId: `${AI_PARSER_PREFIX}${provider.model}`,
        providerName: result.providerName ?? '',
        parserVersion: EXTRACT_PROMPT_VERSION,
        extraction: result.extraction,
        check: validateExtraction(result.extraction, qr),
      });
    } catch (error) {
      const usage = (error as { usage?: AiUsage[] }).usage;
      if (usage) await recordUsage(session.repos, usage);
      setProblem(aiErrorText(error instanceof AiError ? error.code : 'unavailable'));
      started.current = false;
    } finally {
      setBusy(false);
    }
  }

  const auto = Boolean(settings?.aiAutoSend && settings.aiApiKey && source);
  useEffect(() => {
    if (!auto) return;
    // After this render, not inside it.
    const timer = window.setTimeout(() => void send(), 0);
    return () => window.clearTimeout(timer);
    // Only once, when the settings say so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  if (!settings) return null;
  if (!settings.aiApiKey) return <p className="muted ai-panel">{copy.noKey}</p>;
  if (!source) return <p className="muted ai-panel">{copy.cannotSend}</p>;

  const model = aiModelOf(settings);
  const estimate = estimateExtraction(model, source, pdfPages);
  return (
    <div className="ai-panel">
      <p>{copy.intro}</p>
      <p className="muted">
        {copy.willSend}{' '}
        {source.kind === 'text'
          ? copy.sendText(source.text.length)
          : source.kind === 'pdf'
            ? copy.sendPdf
            : copy.sendImage}
        . {copy.model(findModel(model).label)} {copy.cost(formatMicroUsd(estimate.costMicroUsd))}
      </p>
      {source.kind === 'text' && (
        <details className="ai-sent">
          <summary>{copy.showText}</summary>
          <pre>{source.text}</pre>
        </details>
      )}
      {problem && (
        <p className="ingest-problem" role="alert">
          {problem}
        </p>
      )}
      <button type="button" className="action-primary" disabled={busy} onClick={() => void send()}>
        {busy ? copy.sending : copy.send}
      </button>
    </div>
  );
}
