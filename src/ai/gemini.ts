/**
 * Google Gemini implementation of AiProvider, with the user's own key. Runs in
 * the browser: requests go straight to generativelanguage.googleapis.com,
 * never through a server of ours. Plain REST (no SDK); the key travels in a
 * header, never in the URL.
 *
 * In the EEA the Gemini API terms (in force since 2026-03-23,
 * aistudio.google.com/docs/terms) allow only Paid Services in apps offered to
 * users, so the key must belong to a Google Cloud project with billing turned
 * on; the settings screen says so (as in Prazómetro and Validómetro).
 */
import { costMicroUsd } from './models';
import { toProposalReading } from './prompts/proposal';
import { toExtraction, type DocumentTarget } from './prompts/extract';
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type InvoiceSource,
  type TextRequest,
} from './provider';
import { extractTask, parseAnswer, proposalTask, type StructuredTask } from './tasks';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_OUTPUT_TOKENS = 16_000;
const MAX_TEXT_LENGTH = 200_000;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

function sourceParts(source: InvoiceSource): Part[] {
  if (source.kind === 'pdf') {
    return [{ inline_data: { mime_type: 'application/pdf', data: source.base64 } }];
  }
  if (source.kind === 'image') {
    return [source, ...(source.more ?? [])].map((page) => ({
      inline_data: { mime_type: page.mime, data: page.base64 },
    }));
  }
  return [];
}

async function failure(response: Response): Promise<AiError> {
  let reason = '';
  try {
    const body = (await response.json()) as { error?: { status?: string; message?: string } };
    reason = `${body.error?.status ?? ''} ${body.error?.message ?? ''}`;
  } catch {
    // No body: the status says enough.
  }
  if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(reason)) {
    return new AiError('invalid_key');
  }
  if (response.status === 401 || response.status === 403) return new AiError('invalid_key');
  if (response.status === 400 && /billing|FAILED_PRECONDITION/i.test(reason)) {
    return new AiError('no_credit');
  }
  if (response.status === 413 || /too large|exceeds/i.test(reason)) {
    return new AiError('too_large');
  }
  if (response.status === 429) return new AiError('rate_limited');
  if (response.status === 400) return new AiError('invalid_output');
  return new AiError('unavailable');
}

export class GeminiProvider implements AiProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: GeminiOptions) {
    if (!options.apiKey.trim()) throw new AiError('no_key');
    if (!/^[a-z0-9.-]+$/.test(options.model)) throw new AiError('unavailable');
    this.model = options.model;
    this.apiKey = options.apiKey.trim();
    // Bound: a bare `fetch` reference loses `window` in some browsers.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async call(body: unknown): Promise<GeminiResponse> {
    let response: Response;
    try {
      response = await this.fetcher(`${GEMINI_ENDPOINT}/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AiError('offline');
    }
    if (!response.ok) throw await failure(response);
    const answer = (await response.json()) as GeminiResponse;
    if (answer.promptFeedback?.blockReason) throw new AiError('refused');
    if (answer.candidates?.[0]?.finishReason === 'SAFETY') throw new AiError('refused');
    return answer;
  }

  private usage(task: AiUsage['task'], promptVersion: string, answer: GeminiResponse): AiUsage {
    const meta = answer.usageMetadata;
    const inputTokens = meta?.promptTokenCount ?? 0;
    // Thinking is billed as output.
    const outputTokens = (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
    return {
      task,
      model: this.model,
      promptVersion,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(this.model, inputTokens, outputTokens),
    };
  }

  /** Checks the key and the model without generating anything (costs nothing). */
  async testConnection(): Promise<AiUsage> {
    let response: Response;
    try {
      response = await this.fetcher(`${GEMINI_ENDPOINT}/${this.model}`, {
        headers: { 'x-goog-api-key': this.apiKey },
      });
    } catch {
      throw new AiError('offline');
    }
    if (!response.ok) throw await failure(response);
    return {
      task: 'test',
      model: this.model,
      promptVersion: 'test',
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
    };
  }

  private async structured<T>(
    source: InvoiceSource,
    task: StructuredTask<T>,
  ): Promise<{ data: T; usage: AiUsage[] }> {
    if (source.kind === 'text' && source.text.length > MAX_TEXT_LENGTH) {
      throw new AiError('too_large');
    }
    const body = {
      systemInstruction: { parts: [{ text: task.system }] },
      contents: [{ role: 'user', parts: [...sourceParts(source), { text: task.prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseJsonSchema: task.schema,
      },
    };
    const usage: AiUsage[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await this.call(body);
      usage.push(this.usage(task.task, task.promptVersion, answer));
      const text = (answer.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      const data = parseAnswer(text, task.validator);
      if (data) return { data, usage };
    }
    const error = new AiError('invalid_output');
    Object.assign(error, { usage });
    throw error;
  }

  async extract(source: InvoiceSource, target?: DocumentTarget) {
    const text = source.kind === 'text' ? source.text : undefined;
    const { data, usage } = await this.structured(source, extractTask(text, target));
    return { ...toExtraction(data), usage };
  }

  async readProposal(source: InvoiceSource, coverages: string[]) {
    const text = source.kind === 'text' ? source.text : undefined;
    const { data, usage } = await this.structured(source, proposalTask(text, coverages));
    return { reading: toProposalReading(data, coverages), usage };
  }

  async writeText(request: TextRequest): Promise<{ text: string; usage: AiUsage }> {
    const answer = await this.call({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      // The limit counts thinking too: room for it on top of the answer (only what is used is billed).
      generationConfig: { temperature: 0.3, maxOutputTokens: request.maxOutputTokens + 6_000 },
    });
    const text = (answer.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) throw new AiError('invalid_output');
    return { text, usage: this.usage(request.task, request.promptVersion, answer) };
  }
}
