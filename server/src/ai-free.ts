/**
 * The free AI (CLAUDE.md, rule 1, the free AI exception): Workers AI with no
 * key and no account, as in Prazómetro (workers/api/src/ai-free.ts).
 *
 *   GET  /v1/ai/free/status   (header X-Device)  → {available, left, limit}
 *   POST /v1/ai/free          (header X-Device)  → {output, inputTokens, outputTokens, left}
 *        {task: 'extract', text | images, target?}
 *        {task: 'proposal', text | images, coverages}
 *        {task: 'explain' | 'letter', system, user, maxOutputTokens}
 *
 * The prompts are the app's own (src/ai/tasks.ts, src/ai/prompts/assist.ts):
 * the server builds them, or accepts only those, so it is never a free
 * general-purpose model. Text arrives anonymized and is anonymized again here.
 * Nothing of the request is stored or logged: only, per day, sha256(day +
 * device id) with a count of calls and the Neurons spent, deleted the next day.
 *
 * Limits: FREE_READS_PER_DEVICE per device and day, and for everyone the
 * account's free daily Neurons minus a reserve (Workers AI free allocation).
 */
import { z } from 'zod';
import { anonymizeText } from '../../src/ai/anonymize';
import { EXPLAIN_SYSTEM, letterSystem } from '../../src/ai/prompts/assist';
import { extractTask, proposalTask } from '../../src/ai/tasks';
import type { Sql } from './db';

/** Workers AI model: reads images and follows a JSON Schema (as in Validómetro). */
export const FREE_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const FREE_READS_PER_DEVICE = 10;
/** The Workers AI free allocation, per account and per UTC day. */
export const FREE_NEURONS_PER_DAY = 10_000;
/** Left aside for the end of the day: one more invoice should not fail halfway. */
export const NEURON_RESERVE = 1_000;
export const MAX_TEXT = 40_000;
export const MAX_IMAGES = 4;
/** One image as base64 (the app sends JPEG of at most ~1600 px, well below this). */
export const MAX_IMAGE_LENGTH = 2_000_000;
/** Whole request body, in characters. */
export const MAX_BODY_LENGTH = MAX_IMAGES * MAX_IMAGE_LENGTH + 200_000;
const MAX_OUTPUT_TOKENS = 6_000;

/**
 * Neurons from tokens, with the model's catalogue prices and the Neuron's
 * price (USD 0.011 per 1000), as in Validómetro (src/ai/providers/workers-ai.ts).
 */
const PRICE_IN = 0.1;
const PRICE_OUT = 0.3;
const USD_PER_NEURON = 0.011 / 1000;

export function neuronsFor(inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;
  return Math.ceil(usd / USD_PER_NEURON);
}

/** The subset of the Workers AI binding used here. */
export interface WorkersAi {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface FreeAiConfig {
  sql: Sql;
  ai?: WorkersAi;
  now: () => Date;
  readsPerDevice?: number;
  neuronsPerDay?: number;
}

export class FreeAiError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const image = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  base64: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .max(MAX_IMAGE_LENGTH),
});
const documentFields = {
  text: z.string().trim().min(20).max(MAX_TEXT).optional(),
  images: z.array(image).min(1).max(MAX_IMAGES).optional(),
};
const RequestBody = z.discriminatedUnion('task', [
  z.object({
    task: z.literal('extract'),
    ...documentFields,
    target: z.object({ docId: z.string().max(100), totalCents: z.number().int() }).optional(),
  }),
  z.object({
    task: z.literal('proposal'),
    ...documentFields,
    coverages: z.array(z.string().max(200)).max(60),
  }),
  z.object({
    task: z.enum(['explain', 'letter']),
    system: z.string().max(4_000),
    user: z.string().min(1).max(20_000),
    maxOutputTokens: z.number().int().min(1).max(4_000),
  }),
]);
type RequestBody = z.infer<typeof RequestBody>;

const ALLOWED_SYSTEMS = new Set([EXPLAIN_SYSTEM, letterSystem(true), letterSystem(false)]);

interface ChatOutput {
  choices?: { message?: { content?: string | null } }[];
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type Message = { role: 'system' | 'user'; content: unknown };

/** The model's messages, built from the app's prompts. */
function messagesOf(input: RequestBody): {
  messages: Message[];
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens: number;
} {
  if ('system' in input) {
    if (!ALLOWED_SYSTEMS.has(input.system)) throw new FreeAiError(400, 'Invalid request');
    return {
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: anonymizeText(input.user).text },
      ],
      maxTokens: input.maxOutputTokens,
    };
  }
  if ((input.text === undefined) === (input.images === undefined)) {
    throw new FreeAiError(400, 'Invalid request');
  }
  const text = input.text === undefined ? undefined : anonymizeText(input.text).text;
  const task =
    input.task === 'extract'
      ? extractTask(text, input.target)
      : proposalTask(text, input.coverages);
  const content = input.images
    ? [
        ...input.images.map((page) => ({
          type: 'image_url',
          image_url: { url: `data:${page.mime};base64,${page.base64}` },
        })),
        { type: 'text', text: task.prompt },
      ]
    : task.prompt;
  return {
    messages: [
      { role: 'system', content: task.system },
      { role: 'user', content },
    ],
    schema: { name: task.schemaName, schema: task.schema },
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

export function createFreeAi(config: FreeAiConfig) {
  const { sql } = config;
  const perDevice = config.readsPerDevice ?? FREE_READS_PER_DEVICE;
  const neuronsCap = (config.neuronsPerDay ?? FREE_NEURONS_PER_DAY) - NEURON_RESERVE;

  const day = () => config.now().toISOString().slice(0, 10);

  async function deviceOf(request: Request, date: string): Promise<string> {
    const parsed = DeviceId.safeParse(request.headers.get('X-Device'));
    if (!parsed.success) throw new FreeAiError(400, 'Invalid request');
    return sha256Hex(`${date}:${parsed.data}`);
  }

  async function usage(date: string, device: string) {
    const row = await sql.first<{ mine: number; neurons: number }>(
      `SELECT COALESCE(SUM(CASE WHEN device = ? THEN calls END), 0) AS mine,
              COALESCE(SUM(neurons), 0) AS neurons
       FROM ai_free_daily WHERE date = ?`,
      device,
      date,
    );
    return { mine: row?.mine ?? 0, neurons: row?.neurons ?? 0 };
  }

  async function status(request: Request) {
    const date = day();
    const used = await usage(date, await deviceOf(request, date));
    return {
      available: Boolean(config.ai) && used.neurons < neuronsCap,
      left: Math.max(0, perDevice - used.mine),
      limit: perDevice,
    };
  }

  async function read(request: Request, text: string) {
    if (!config.ai) throw new FreeAiError(503, 'ai_unavailable');
    const date = day();
    const device = await deviceOf(request, date);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new FreeAiError(400, 'Invalid JSON');
    }
    const parsed = RequestBody.safeParse(json);
    if (!parsed.success) throw new FreeAiError(400, 'Invalid request');
    const { messages, schema, maxTokens } = messagesOf(parsed.data);

    const used = await usage(date, device);
    if (used.mine >= perDevice) throw new FreeAiError(429, 'free_limit');
    if (used.neurons >= neuronsCap) throw new FreeAiError(503, 'free_quota');

    let output: ChatOutput;
    try {
      output = (await config.ai.run(FREE_AI_MODEL, {
        messages,
        ...(schema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: schema.name, schema: schema.schema, strict: true },
              },
            }
          : {}),
        max_completion_tokens: maxTokens,
        temperature: schema ? 0 : 0.3,
        // Thinking would spend Neurons on a reading task.
        chat_template_kwargs: { enable_thinking: false },
      })) as ChatOutput;
    } catch (error) {
      // Only the kind of error: never the request.
      const message = error instanceof Error ? error.message : '';
      if (/4006|daily free allocation|neurons/i.test(message)) {
        throw new FreeAiError(503, 'free_quota');
      }
      if (/too large|payload|413/i.test(message)) throw new FreeAiError(413, 'too_large');
      throw new FreeAiError(502, 'ai_failed');
    }

    const inputTokens = output.usage?.prompt_tokens ?? 0;
    const outputTokens = output.usage?.completion_tokens ?? 0;
    await sql.run(
      `INSERT INTO ai_free_daily (date, device, calls, neurons) VALUES (?, ?, 1, ?)
       ON CONFLICT (date, device) DO UPDATE SET calls = calls + 1, neurons = neurons + excluded.neurons`,
      date,
      device,
      neuronsFor(inputTokens, outputTokens),
    );
    const content = output.choices?.[0]?.message?.content ?? output.response;
    return {
      output: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      inputTokens,
      outputTokens,
      left: Math.max(0, perDevice - used.mine - 1),
    };
  }

  return { status, read };
}
