/**
 * Models offered in the settings, with list prices in US dollars per million
 * tokens, as published on platform.claude.com/docs/en/about-claude/pricing
 * (checked on PRICES_CHECKED). Haiku 5.5 is priced for prompts up to
 * 100 000 tokens, far above the size of an invoice.
 */
export const PRICES_CHECKED = '2026-10-13';

export interface AiModel {
  id: string;
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export const AI_MODELS: readonly AiModel[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
  },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', inputUsdPerMTok: 4, outputUsdPerMTok: 20 },
];

/** Chosen by the evaluation in Phase 5 (scripts/ai-eval.ts, PLAN.md §16). */
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';

export function findModel(id: string | undefined): AiModel {
  return AI_MODELS.find((model) => model.id === id) ?? AI_MODELS[0]!;
}

/**
 * Cost in millionths of a US dollar, as an integer (tokens × $/MTok is
 * exactly micro-dollars). An estimate: prices may change; we never charge.
 */
export function costMicroUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = findModel(modelId);
  return Math.round(inputTokens * model.inputUsdPerMTok + outputTokens * model.outputUsdPerMTok);
}

/** E.g. "0,0012 US$" (four decimals: invoice requests cost fractions of a cent). */
export function formatMicroUsd(micro: number): string {
  const usd = (micro / 1_000_000).toLocaleString('pt-PT', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `${usd} US$`;
}
