/**
 * Cost estimate shown before anything is sent. Computed locally on purpose:
 * the API's exact token count would itself send the invoice to Anthropic
 * before the user agreed. Rough and on the high side:
 * - text: about 3 characters per token in Portuguese, plus the prompt;
 * - photos: images are resized to about 1.15 megapixels, (w × h) / 750 tokens;
 * - scanned PDFs: each page is read as text and as an image.
 */
import { costMicroUsd } from './models';
import { EXTRACT_SYSTEM } from './prompts/extract';
import { PROPOSAL_SYSTEM } from './prompts/proposal';
import type { AiEstimate, InvoiceSource } from './provider';

const CHARS_PER_TOKEN = 3;
/** The JSON schema and its instructions, added by the API to the prompt. */
const SCHEMA_OVERHEAD_TOKENS = 1_500;
const IMAGE_TOKENS = 1_600;
const PDF_PAGE_TOKENS = 3_000;
/** Typical upper bound of the extraction answer (thinking included). */
export const EXTRACT_EXPECTED_OUTPUT = 4_000;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateExtraction(
  model: string,
  source: InvoiceSource,
  pdfPages = 1,
  system = EXTRACT_SYSTEM,
): AiEstimate {
  const document =
    source.kind === 'text'
      ? estimateTextTokens(source.text)
      : source.kind === 'image'
        ? IMAGE_TOKENS * (1 + (source.more?.length ?? 0))
        : PDF_PAGE_TOKENS * Math.max(1, pdfPages);
  const inputTokens = estimateTextTokens(system) + SCHEMA_OVERHEAD_TOKENS + document;
  return {
    inputTokens,
    outputTokens: EXTRACT_EXPECTED_OUTPUT,
    costMicroUsd: costMicroUsd(model, inputTokens, EXTRACT_EXPECTED_OUTPUT),
  };
}

/** An insurance proposal: like an invoice, with its own prompt. */
export function estimateProposal(model: string, source: InvoiceSource, pdfPages = 1): AiEstimate {
  return estimateExtraction(model, source, pdfPages, PROPOSAL_SYSTEM);
}

export function estimateText(
  model: string,
  system: string,
  user: string,
  maxOutputTokens: number,
): AiEstimate {
  const inputTokens = estimateTextTokens(system) + estimateTextTokens(user);
  return {
    inputTokens,
    outputTokens: maxOutputTokens,
    costMicroUsd: costMicroUsd(model, inputTokens, maxOutputTokens),
  };
}
