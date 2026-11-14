/**
 * The structured tasks (invoice extraction, insurance proposal) described
 * once, for the providers that build their own requests (Gemini, the free
 * AI's server). Anthropic builds the same pieces in anthropic.ts.
 */
import {
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  extractResponseSchema,
  extractUserPrompt,
  type DocumentTarget,
  type ExtractResponse,
} from './prompts/extract';
import {
  PROPOSAL_PROMPT_VERSION,
  PROPOSAL_SCHEMA,
  PROPOSAL_SYSTEM,
  proposalResponseSchema,
  proposalUserPrompt,
  type ProposalResponse,
} from './prompts/proposal';

export interface Validator<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface StructuredTask<T> {
  task: 'extract' | 'proposal';
  promptVersion: string;
  /** Name of the JSON schema (some APIs ask for one). */
  schemaName: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  validator: Validator<T>;
}

/** `text`: the document's text when it is sent as text, else undefined (the file is attached). */
export function extractTask(
  text: string | undefined,
  target?: DocumentTarget,
): StructuredTask<ExtractResponse> {
  return {
    task: 'extract',
    promptVersion: EXTRACT_PROMPT_VERSION,
    schemaName: 'fatura',
    system: EXTRACT_SYSTEM,
    prompt: extractUserPrompt(text, target),
    schema: EXTRACT_SCHEMA,
    validator: extractResponseSchema,
  };
}

export function proposalTask(
  text: string | undefined,
  coverages: string[],
): StructuredTask<ProposalResponse> {
  return {
    task: 'proposal',
    promptVersion: PROPOSAL_PROMPT_VERSION,
    schemaName: 'proposta',
    system: PROPOSAL_SYSTEM,
    prompt: proposalUserPrompt(text, coverages),
    schema: PROPOSAL_SCHEMA,
    validator: proposalResponseSchema,
  };
}

/** The model's JSON answer, checked; undefined when it is not JSON or not the expected shape. */
export function parseAnswer<T>(text: string, validator: Validator<T>): T | undefined {
  try {
    const parsed = validator.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
