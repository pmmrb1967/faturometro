import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { estimateText } from '../../ai/estimate';
import { findModel, formatMicroUsd } from '../../ai/models';
import {
  explainRequest,
  fillPlaceholders,
  letterRequest,
  type LetterKind,
} from '../../ai/prompts/assist';
import { AiError, type TextRequest } from '../../ai/provider';
import { aiModelOf, providerFromSettings, recordUsage } from '../../ai/session';
import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { contractContext } from './context';
import { aiErrorText } from './errors';

const copy = t.ai.assistant;
type Pending = { request: TextRequest; letter: boolean };

export function ContractAssistant({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; cost: number; letter: boolean }>();
  const [problem, setProblem] = useState<string>();
  const [copied, setCopied] = useState(false);
  if (!session || !settings) return null;
  const { repos } = session;

  async function prepare(kind: 'explain' | LetterKind) {
    setAnswer(undefined);
    setProblem(undefined);
    const context = await contractContext(repos, contract);
    const request = kind === 'explain' ? explainRequest(context) : letterRequest(kind, context);
    setPending({ request, letter: kind !== 'explain' });
  }

  async function send() {
    if (!pending) return;
    const provider = providerFromSettings(await getSettings(repos));
    if (!provider) return;
    setBusy(true);
    try {
      const result = await provider.writeText(pending.request);
      await recordUsage(repos, [result.usage]);
      const text = pending.letter
        ? fillPlaceholders(result.text, {
            ...(contract.customerNumber ? { customerNumber: contract.customerNumber } : {}),
            ...(contract.supplyPointId ? { supplyPoint: contract.supplyPointId } : {}),
          })
        : result.text;
      setAnswer({ text, cost: result.usage.costMicroUsd, letter: pending.letter });
      setPending(undefined);
    } catch (error) {
      setProblem(aiErrorText(error instanceof AiError ? error.code : 'unavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    await navigator.clipboard.writeText(answer.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const model = aiModelOf(settings);
  const estimate = pending
    ? estimateText(
        model,
        pending.request.system,
        pending.request.user,
        pending.request.maxOutputTokens,
      )
    : undefined;

  return (
    <section className="ai-assistant" aria-labelledby="ai-assistant-title">
      <h2 id="ai-assistant-title" className="section-title">
        {copy.title}
      </h2>
      {!settings.aiApiKey ? (
        <p className="muted">{copy.noKey}</p>
      ) : (
        <>
          <p className="muted">{copy.intro}</p>
          <div className="ingest-actions">
            <button
              type="button"
              className="action-secondary"
              onClick={() => void prepare('explain')}
            >
              {copy.explain}
            </button>
            {(['renegotiate', 'cancel', 'estimated_reading'] as const)
              .filter((kind) => kind !== 'estimated_reading' || contract.sector !== 'telecom')
              .map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="action-secondary"
                  onClick={() => void prepare(kind)}
                >
                  {copy.letters[kind]}
                </button>
              ))}
          </div>

          {pending && estimate && (
            <div className="ai-panel">
              <p>{copy.confirm(formatMicroUsd(estimate.costMicroUsd), findModel(model).label)}</p>
              <details className="ai-sent">
                <summary>{copy.showData}</summary>
                <pre>{pending.request.user}</pre>
              </details>
              <div className="ingest-actions">
                <button
                  type="button"
                  className="action-primary"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? copy.working : copy.send}
                </button>
                <button
                  type="button"
                  className="action-secondary"
                  disabled={busy}
                  onClick={() => setPending(undefined)}
                >
                  {copy.cancel}
                </button>
              </div>
            </div>
          )}
          {problem && (
            <p className="ingest-problem" role="alert">
              {problem}
            </p>
          )}
          {answer && (
            <article className="ai-answer">
              <div className="ai-answer-text">{answer.text}</div>
              {answer.letter && <p className="muted">{copy.placeholdersNote}</p>}
              <p className="muted">{copy.cost(formatMicroUsd(answer.cost))}</p>
              <button type="button" className="action-secondary" onClick={() => void copyAnswer()}>
                {copied ? copy.copied : copy.copy}
              </button>
            </article>
          )}
        </>
      )}
    </section>
  );
}
