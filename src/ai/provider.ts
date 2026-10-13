/**
 * AI abstraction (PLAN.md §10). The app never calls an SDK directly: it
 * goes through an AiProvider, so other providers can be added later and
 * tests can use a fake one.
 */
import type { AiExtraction } from './prompts/extract';

export type AiErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'no_credit'
  | 'rate_limited'
  | 'unavailable'
  | 'offline'
  | 'invalid_output'
  | 'refused'
  | 'too_large';

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode) {
    super(code);
    this.name = 'AiError';
    this.code = code;
  }
}

/** What the invoice is sent as: its text when the PDF has one, else the file itself. */
export type InvoiceSource =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }
  | {
      kind: 'image';
      mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      base64: string;
    };

export type AiTask = 'extract' | 'explain' | 'letter' | 'test';

export interface AiUsage {
  task: AiTask;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface AiEstimate {
  inputTokens: number;
  /** Upper bound used for the cost: the answer's length is not known in advance. */
  outputTokens: number;
  costMicroUsd: number;
}

export interface TextRequest {
  task: Exclude<AiTask, 'extract' | 'test'>;
  promptVersion: string;
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface AiProvider {
  readonly model: string;
  /** A tiny request to check the key and the model. */
  testConnection(): Promise<AiUsage>;
  /**
   * Structured extraction, validated with zod; one retry at most. With
   * several invoices in one file, `docId` says which one.
   */
  extract(source: InvoiceSource, docId?: string): Promise<AiExtraction & { usage: AiUsage[] }>;
  writeText(request: TextRequest): Promise<{ text: string; usage: AiUsage }>;
}
