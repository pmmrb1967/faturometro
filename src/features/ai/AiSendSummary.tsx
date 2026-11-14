import { freeText } from '../../ai/free';
import { findModel, formatMicroUsd } from '../../ai/models';
import type { InvoiceSource } from '../../ai/provider';
import { aiModeOf, aiModelOf } from '../../ai/session';
import type { Settings } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { describeRemoved } from './describe-removed';

interface Props {
  settings: Partial<Settings>;
  source: InvoiceSource;
  /** What is sent, in words ("o texto da fatura (1 234 carateres)"). */
  what: string;
  costMicroUsd: number;
}

/**
 * What will be sent, where to and what it costs, shown before sending. With
 * the free AI, the text shown is the anonymized one, as it will leave.
 */
export function AiSendSummary({ settings, source, what, costMicroUsd }: Props) {
  const mode = aiModeOf(settings);
  const free = mode === 'free';
  const anonymized =
    free && source.kind === 'text'
      ? freeText(source.text, settings.ownNif ? [settings.ownNif] : [])
      : undefined;
  const text = anonymized?.text ?? (source.kind === 'text' ? source.text : undefined);
  return (
    <>
      <p className="muted">
        {t.ai.extract.willSend(t.ai.destinations[mode])} {what}.{' '}
        {free
          ? t.ai.free.cost
          : `${t.ai.extract.model(findModel(aiModelOf(settings)).label)} ${t.ai.extract.cost(formatMicroUsd(costMicroUsd))}`}
      </p>
      {anonymized && (
        <p className="muted">
          {Object.keys(anonymized.removed).length > 0
            ? t.ai.free.removed(describeRemoved(anonymized.removed))
            : t.ai.free.nothingRemoved}
        </p>
      )}
      {free && source.kind !== 'text' && <p className="muted">{t.ai.free.imagesAsIs}</p>}
      {text !== undefined && (
        <details className="ai-sent">
          <summary>{t.ai.extract.showText}</summary>
          <pre>{text}</pre>
        </details>
      )}
    </>
  );
}
