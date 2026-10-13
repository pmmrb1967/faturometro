/**
 * Anthropic implementation of AiProvider. Runs in the browser with the
 * user's own key (BYOK): requests go straight to api.anthropic.com, never
 * through a server of ours.
 */
import Anthropic from '@anthropic-ai/sdk';
import { costMicroUsd } from './models';
import {
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  extractResponseSchema,
  extractUserPrompt,
  toExtraction,
} from './prompts/extract';
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type InvoiceSource,
  type TextRequest,
} from './provider';

/** Room for thinking plus the JSON answer of a long invoice. */
const EXTRACT_MAX_TOKENS = 16_000;
const MAX_TEXT_LENGTH = 200_000;

export type Effort = 'low' | 'medium' | 'high';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort?: Effort;
  /** For tests and the evaluation script (Node). */
  fetch?: typeof fetch;
  /** The browser build sets this; Node scripts do not need it. */
  browser?: boolean;
}

type ContentBlock = Anthropic.ContentBlockParam;

function sourceBlocks(source: InvoiceSource): ContentBlock[] {
  if (source.kind === 'pdf') {
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: source.base64 },
      },
    ];
  }
  if (source.kind === 'image') {
    return [
      { type: 'image', source: { type: 'base64', media_type: source.mime, data: source.base64 } },
    ];
  }
  return [];
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AiError('invalid_key');
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError('invalid_key');
  if (error instanceof Anthropic.RateLimitError) return new AiError('rate_limited');
  if (error instanceof Anthropic.APIConnectionError) return new AiError('offline');
  if (error instanceof Anthropic.BadRequestError) {
    // Out of credit is reported as a 400 with this wording.
    if (/credit balance/i.test(error.message)) return new AiError('no_credit');
    if (/too long|too large|exceed/i.test(error.message)) return new AiError('too_large');
    return new AiError('invalid_output');
  }
  if (error instanceof Anthropic.APIError) return new AiError('unavailable');
  return new AiError('unavailable');
}

export class AnthropicProvider implements AiProvider {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;

  constructor(options: AnthropicOptions) {
    if (!options.apiKey.trim()) throw new AiError('no_key');
    this.model = options.model;
    this.effort = options.effort ?? 'low';
    this.client = new Anthropic({
      apiKey: options.apiKey.trim(),
      dangerouslyAllowBrowser: options.browser ?? false,
      maxRetries: 1,
      timeout: 120_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  private usage(
    task: AiUsage['task'],
    promptVersion: string,
    response: Anthropic.Message,
  ): AiUsage {
    const inputTokens =
      response.usage.input_tokens +
      (response.usage.cache_creation_input_tokens ?? 0) +
      (response.usage.cache_read_input_tokens ?? 0);
    const outputTokens = response.usage.output_tokens;
    return {
      task,
      model: this.model,
      promptVersion,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(this.model, inputTokens, outputTokens),
    };
  }

  async testConnection(): Promise<AiUsage> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Responde só: ok' }],
        output_config: { effort: 'low' },
      });
      return this.usage('test', 'test', response);
    } catch (error) {
      throw toAiError(error);
    }
  }

  private extractionParams(source: InvoiceSource, docId?: string) {
    if (source.kind === 'text' && source.text.length > MAX_TEXT_LENGTH) {
      throw new AiError('too_large');
    }
    return {
      model: this.model,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user' as const,
          content: [
            ...sourceBlocks(source),
            {
              type: 'text' as const,
              text: extractUserPrompt(source.kind === 'text' ? source.text : undefined, docId),
            },
          ],
        },
      ],
      output_config: {
        effort: this.effort,
        format: { type: 'json_schema' as const, schema: EXTRACT_SCHEMA },
      },
    };
  }

  async extract(source: InvoiceSource, docId?: string) {
    const params = this.extractionParams(source, docId);
    const usage: AiUsage[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({ ...params, max_tokens: EXTRACT_MAX_TOKENS });
      } catch (error) {
        throw toAiError(error);
      }
      usage.push(this.usage('extract', EXTRACT_PROMPT_VERSION, response));
      if (response.stop_reason === 'refusal') throw new AiError('refused');
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      try {
        const parsed = extractResponseSchema.safeParse(JSON.parse(text));
        if (parsed.success) return { ...toExtraction(parsed.data), usage };
      } catch {
        // Not JSON (e.g. cut by max_tokens): one more attempt.
      }
    }
    const error = new AiError('invalid_output');
    Object.assign(error, { usage });
    throw error;
  }

  private textParams(request: TextRequest) {
    return {
      model: this.model,
      system: request.system,
      messages: [{ role: 'user' as const, content: request.user }],
      output_config: { effort: this.effort },
    };
  }

  async writeText(request: TextRequest): Promise<{ text: string; usage: AiUsage }> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        ...this.textParams(request),
        max_tokens: request.maxOutputTokens,
      });
    } catch (error) {
      throw toAiError(error);
    }
    if (response.stop_reason === 'refusal') throw new AiError('refused');
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return { text, usage: this.usage(request.task, request.promptVersion, response) };
  }
}
