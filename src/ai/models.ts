/**
 * Models offered in the settings, with list prices in US dollars per million
 * tokens (checked on PRICES_CHECKED):
 * - Anthropic: platform.claude.com/docs/en/about-claude/pricing. Haiku 5.5 is
 *   priced for prompts up to 100 000 tokens, far above the size of an invoice.
 * - Google: ai.google.dev/gemini-api/docs/pricing (standard paid tier).
 *   Gemini 3.8 Flash has an introductory price until 2026-12-31 (0.75 / 3.75);
 *   the price from 2027-01-01 is used, so the estimate stays on the high side.
 * - The free AI (Workers AI) costs the user nothing: it spends the project's
 *   daily Neurons, counted on the server (server/src/ai-free.ts).
 */
export const PRICES_CHECKED = '2026-11-14';

/** Who answers: the user's own key (anthropic, gemini) or the project's free AI. */
export type AiVendor = 'anthropic' | 'gemini' | 'free';

export interface AiModel {
  id: string;
  vendor: AiVendor;
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/** Workers AI model of the free AI (as in Prazómetro and Validómetro). */
export const FREE_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export const AI_MODELS: readonly AiModel[] = [
  {
    id: 'claude-haiku-5-5',
    vendor: 'anthropic',
    label: 'Claude Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
  },
  {
    id: 'claude-sonnet-5-5',
    vendor: 'anthropic',
    label: 'Claude Sonnet 5.5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
  },
  {
    id: 'claude-opus-5-5',
    vendor: 'anthropic',
    label: 'Claude Opus 5.5',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
  },
  {
    id: 'gemini-3.5-flash-lite',
    vendor: 'gemini',
    label: 'Gemini 3.5 Flash-Lite',
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 2.5,
  },
  {
    id: 'gemini-3.8-flash',
    vendor: 'gemini',
    label: 'Gemini 3.8 Flash',
    inputUsdPerMTok: 1.5,
    outputUsdPerMTok: 7.5,
  },
  {
    id: FREE_AI_MODEL,
    vendor: 'free',
    label: 'Gemma 4 (IA gratuita)',
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
  },
];

/** Chosen by the evaluation in Phase 5 (scripts/ai-eval.ts, PLAN.md §16). */
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';
/** The cheapest; the same default as Prazómetro and Validómetro. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export const DEFAULT_MODELS: Record<AiVendor, string> = {
  anthropic: DEFAULT_AI_MODEL,
  gemini: DEFAULT_GEMINI_MODEL,
  free: FREE_AI_MODEL,
};

export function modelsOf(vendor: AiVendor): AiModel[] {
  return AI_MODELS.filter((model) => model.vendor === vendor);
}

/** The model with this id; an unknown id falls back to the vendor's default (Anthropic's if none). */
export function findModel(id: string | undefined, vendor?: AiVendor): AiModel {
  const known = AI_MODELS.find(
    (model) => model.id === id && (vendor === undefined || model.vendor === vendor),
  );
  if (known) return known;
  const fallback = DEFAULT_MODELS[vendor ?? 'anthropic'];
  return AI_MODELS.find((model) => model.id === fallback) ?? AI_MODELS[0]!;
}

/**
 * Cost in millionths of a US dollar, as an integer (tokens × $/MTok is
 * exactly micro-dollars). An estimate: prices may change; we never charge.
 */
export function costMicroUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  // An unknown model is priced as the default Anthropic one.
  const model = findModel(modelId);
  return Math.round(inputTokens * model.inputUsdPerMTok + outputTokens * model.outputUsdPerMTok);
}

/** E.g. "0,0012 US$" (four decimals: invoice requests cost fractions of a cent). */
export function formatMicroUsd(micro: number): string {
  if (micro > 0 && micro < 100) return '< 0,0001 US$';
  const usd = (micro / 1_000_000).toLocaleString('pt-PT', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `${usd} US$`;
}
