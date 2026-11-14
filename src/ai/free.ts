/**
 * The free AI ("IA gratuita do Faturómetro"): no key and no account. Requests
 * go to the project's server (server/src/ai-free.ts), which asks Workers AI
 * and keeps nothing but a daily count per device.
 *
 * What leaves the device (CLAUDE.md, rule 1, the free AI exception):
 * - an invoice's text, anonymized here first (and again on the server);
 * - photos and scanned pages as images, which cannot be anonymized (the app
 *   says so before sending);
 * - for explanations and letters, the same structured data as with a key.
 * The device is a random id; the server stores only sha256(day + id).
 */
import { anonymizeText } from './anonymize';
import { FREE_AI_MODEL } from './models';
import { toExtraction, type DocumentTarget } from './prompts/extract';
import { toProposalReading } from './prompts/proposal';
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type ImageMime,
  type InvoiceSource,
  type TextRequest,
} from './provider';
import { extractTask, parseAnswer, proposalTask } from './tasks';

/** The same limits as the server (server/src/ai-free.ts). */
export const FREE_READS_PER_DAY = 10;
export const FREE_MAX_IMAGES = 4;
export const FREE_MAX_TEXT = 40_000;

export interface FreeImage {
  mime: ImageMime;
  base64: string;
}

export interface FreeStatus {
  available: boolean;
  left: number;
  limit: number;
}

export interface FreeOptions {
  /** The project's sync server (src/sync/default-server.ts). */
  serverUrl: string;
  deviceId: string;
  /** Values that identify the person (own NIF…), removed from the text wherever they are. */
  known?: string[];
  /**
   * Photos made smaller and scanned PDF pages turned into images (browser
   * only: src/ai/images.ts). Without it, photos go as they are and scans cannot be sent.
   */
  prepareImages?: (source: Exclude<InvoiceSource, { kind: 'text' }>) => Promise<FreeImage[]>;
  fetch?: typeof fetch;
}

interface FreeAnswer {
  output: string;
  inputTokens: number;
  outputTokens: number;
  left: number;
}

const ERRORS: Record<string, AiError['code']> = {
  free_limit: 'free_limit',
  free_quota: 'free_quota',
  too_large: 'too_large',
  rate_limited: 'rate_limited',
};

/** The text as it will be sent, and what was removed from it (shown before sending). */
export function freeText(text: string, known: string[] = []) {
  return anonymizeText(text, { known });
}

export class FreeProvider implements AiProvider {
  readonly model = FREE_AI_MODEL;
  private readonly options: FreeOptions;
  private readonly fetcher: typeof fetch;

  constructor(options: FreeOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private url(path: string): string {
    return `${this.options.serverUrl.replace(/\/+$/, '')}/v1/ai/free${path}`;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'X-Device': this.options.deviceId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new AiError('offline');
    }
    if (!response.ok) {
      let code = '';
      try {
        code = ((await response.json()) as { error?: string }).error ?? '';
      } catch {
        // No body.
      }
      throw new AiError(ERRORS[code] ?? (response.status === 413 ? 'too_large' : 'unavailable'));
    }
    return (await response.json()) as T;
  }

  status(): Promise<FreeStatus> {
    return this.request<FreeStatus>('/status');
  }

  private usage(task: AiUsage['task'], promptVersion: string, answer: FreeAnswer): AiUsage {
    return {
      task,
      model: this.model,
      promptVersion,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      costMicroUsd: 0,
    };
  }

  /** Checks that the free AI answers today, without spending a reading. */
  async testConnection(): Promise<AiUsage> {
    const status = await this.status();
    if (!status.available) throw new AiError('free_quota');
    if (status.left <= 0) throw new AiError('free_limit');
    return {
      task: 'test',
      model: this.model,
      promptVersion: 'test',
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
    };
  }

  /** The document as the server takes it: anonymized text, or images. */
  private async payload(
    source: InvoiceSource,
  ): Promise<{ text: string } | { images: FreeImage[] }> {
    if (source.kind === 'text') {
      const { text } = freeText(source.text, this.options.known);
      if (text.length > FREE_MAX_TEXT) throw new AiError('too_large');
      return { text };
    }
    let images: FreeImage[];
    if (this.options.prepareImages) {
      images = await this.options.prepareImages(source);
    } else if (source.kind === 'image') {
      images = [source, ...(source.more ?? [])].map(({ mime, base64 }) => ({ mime, base64 }));
    } else {
      throw new AiError('too_large');
    }
    if (images.length === 0 || images.length > FREE_MAX_IMAGES) throw new AiError('too_large');
    return { images };
  }

  async extract(source: InvoiceSource, target?: DocumentTarget) {
    const document = await this.payload(source);
    const answer = await this.request<FreeAnswer>('', {
      task: 'extract',
      ...document,
      ...(target ? { target } : {}),
    });
    const task = extractTask(undefined, target);
    const usage = [this.usage('extract', task.promptVersion, answer)];
    const data = parseAnswer(answer.output, task.validator);
    if (!data) throw Object.assign(new AiError('invalid_output'), { usage });
    return { ...toExtraction(data), usage };
  }

  async readProposal(source: InvoiceSource, coverages: string[]) {
    const document = await this.payload(source);
    const answer = await this.request<FreeAnswer>('', { task: 'proposal', ...document, coverages });
    const task = proposalTask(undefined, coverages);
    const usage = [this.usage('proposal', task.promptVersion, answer)];
    const data = parseAnswer(answer.output, task.validator);
    if (!data) throw Object.assign(new AiError('invalid_output'), { usage });
    return { reading: toProposalReading(data, coverages), usage };
  }

  async writeText(request: TextRequest): Promise<{ text: string; usage: AiUsage }> {
    const answer = await this.request<FreeAnswer>('', {
      task: request.task,
      system: request.system,
      user: request.user,
      maxOutputTokens: request.maxOutputTokens,
    });
    const text = answer.output.trim();
    if (!text) throw new AiError('invalid_output');
    return { text, usage: this.usage(request.task, request.promptVersion, answer) };
  }
}
