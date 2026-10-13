/**
 * Invoice extraction prompt (versioned: bump EXTRACT_PROMPT_VERSION on any
 * change and re-run scripts/ai-eval.ts).
 *
 * The response is a strict JSON schema (structured outputs). To stay within
 * the API's schema limits every field is required: an unknown value is an
 * empty string, never null. Amounts are decimal strings ("12.34"), converted
 * to integer cents here (src/lib/money.ts), never added as floats.
 */
import { z } from 'zod';
import type { InvoiceLine, Reading, Sector } from '../../domain/types';
import { parseDotDecimalAmount } from '../../lib/money';
import type { ExtractedInvoice, ExtractedLine, ExtractedReading } from '../../parsers/types';

export const EXTRACT_PROMPT_VERSION = 'extract-v1';

const SECTORS = ['electricity', 'gas', 'water', 'telecom', 'other'] as const;
const LINE_KINDS = [
  'base_fee',
  'addon',
  'equipment',
  'discount',
  'usage',
  'energy',
  'power',
  'tax',
  'other',
] as const;
const UNITS = ['', 'kWh', 'm3', 'day', 'month', 'min', 'GB'] as const;
const PERIODS = ['', 'empty', 'off_empty', 'full', 'peak'] as const;
const READING_TYPES = ['', 'real', 'estimated', 'customer'] as const;
const BASES = ['', 'real', 'estimated', 'customer', 'adjustment'] as const;

export const EXTRACT_SYSTEM = `Lês faturas domésticas portuguesas (eletricidade, gás, água, telecomunicações e outras) e devolves os dados no formato JSON pedido.

Regras:
- Copia apenas o que está escrito na fatura. Nunca inventes nem estimes. Se um campo não estiver na fatura, devolve "" (texto vazio).
- Datas no formato AAAA-MM-DD.
- Valores em euros com ponto decimal e sem separador de milhares: "1234.56". Descontos com sinal negativo: "-5.00".
- Quantidades com ponto decimal: "123.5".
- sector: electricity, gas, water, telecom ou other (portagens, seguros e o resto).
- docId: o número do documento tal como impresso (ex.: "FT 2026/123").
- periodStart/periodEnd: o período faturado (consumo, ou mensalidade em telecomunicações).
- loyaltyEndDate: fim do período de fidelização, se indicado.
- supplyPointId: CPE (eletricidade) ou CUI (gás), se indicado.
- powerKva: potência contratada em kVA, se indicada.
- lines: as linhas da fatura com valor. kind: base_fee (mensalidade), addon (serviço adicional), equipment, discount, usage (consumos extra), energy (energia/gás consumido), power (potência), tax (taxas e impostos, exceto IVA), other. amount: o valor da linha como está na fatura. vatRate: taxa de IVA da linha em %, se indicada. basis: em linhas de energia, se o consumo é real, estimated (estimado), customer (comunicado pelo cliente) ou adjustment (acerto).
- linesIncludeVat: true se os valores das linhas já incluem IVA (somam o total), false se somam o valor sem IVA.
- readings: leituras do contador (quantidade consumida no período entre leituras), com o tipo e a data da leitura final.
- readingType: tipo da leitura principal da fatura.`;

export function extractUserPrompt(documentText: string | undefined): string {
  return documentText
    ? `Texto da fatura, linha a linha (as células da mesma linha estão separadas por " | "):\n\n${documentText}`
    : 'A fatura está no documento anexo.';
}

/** JSON schema sent to the API (strict: every property required, no extra properties). */
export const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sector',
    'providerName',
    'docId',
    'issueDate',
    'periodStart',
    'periodEnd',
    'dueDate',
    'total',
    'net',
    'vat',
    'customerNumber',
    'supplyPointId',
    'tariffName',
    'powerKva',
    'loyaltyEndDate',
    'readingType',
    'linesIncludeVat',
    'lines',
    'readings',
  ],
  properties: {
    sector: { type: 'string', enum: [...SECTORS] },
    providerName: { type: 'string' },
    docId: { type: 'string' },
    issueDate: { type: 'string' },
    periodStart: { type: 'string' },
    periodEnd: { type: 'string' },
    dueDate: { type: 'string' },
    total: { type: 'string' },
    net: { type: 'string' },
    vat: { type: 'string' },
    customerNumber: { type: 'string' },
    supplyPointId: { type: 'string' },
    tariffName: { type: 'string' },
    powerKva: { type: 'string' },
    loyaltyEndDate: { type: 'string' },
    readingType: { type: 'string', enum: [...READING_TYPES] },
    linesIncludeVat: { type: 'boolean' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'kind',
          'description',
          'amount',
          'quantity',
          'unit',
          'period',
          'vatRate',
          'basis',
        ],
        properties: {
          kind: { type: 'string', enum: [...LINE_KINDS] },
          description: { type: 'string' },
          amount: { type: 'string' },
          quantity: { type: 'string' },
          unit: { type: 'string', enum: [...UNITS] },
          period: { type: 'string', enum: [...PERIODS] },
          vatRate: { type: 'string' },
          basis: { type: 'string', enum: [...BASES] },
        },
      },
    },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quantity', 'unit', 'readingType', 'dateTo', 'period'],
        properties: {
          quantity: { type: 'string' },
          unit: { type: 'string', enum: ['kWh', 'm3'] },
          readingType: { type: 'string', enum: ['real', 'estimated', 'customer'] },
          dateTo: { type: 'string' },
          period: { type: 'string', enum: [...PERIODS] },
        },
      },
    },
  },
} as const;

/** The same contract in zod: what comes back is checked again before use. */
export const extractResponseSchema = z.object({
  sector: z.enum(SECTORS),
  providerName: z.string().max(200),
  docId: z.string().max(100),
  issueDate: z.string().max(20),
  periodStart: z.string().max(20),
  periodEnd: z.string().max(20),
  dueDate: z.string().max(20),
  total: z.string().max(30),
  net: z.string().max(30),
  vat: z.string().max(30),
  customerNumber: z.string().max(100),
  supplyPointId: z.string().max(100),
  tariffName: z.string().max(200),
  powerKva: z.string().max(20),
  loyaltyEndDate: z.string().max(20),
  readingType: z.enum(READING_TYPES),
  linesIncludeVat: z.boolean(),
  lines: z
    .array(
      z.object({
        kind: z.enum(LINE_KINDS),
        description: z.string().max(300),
        amount: z.string().max(30),
        quantity: z.string().max(30),
        unit: z.enum(UNITS),
        period: z.enum(PERIODS),
        vatRate: z.string().max(10),
        basis: z.enum(BASES),
      }),
    )
    .max(200),
  readings: z
    .array(
      z.object({
        quantity: z.string().max(30),
        unit: z.enum(['kWh', 'm3']),
        readingType: z.enum(['real', 'estimated', 'customer']),
        dateTo: z.string().max(20),
        period: z.enum(PERIODS),
      }),
    )
    .max(50),
});

export type ExtractResponse = z.infer<typeof extractResponseSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

function validDate(text: string): string | undefined {
  const value = text.trim();
  if (!ISO_DATE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
    ? value
    : undefined;
}

function cents(text: string): number | undefined {
  return parseDotDecimalAmount(text.trim()) ?? undefined;
}

function decimal(text: string): number | undefined {
  const value = text.trim().replace(',', '.');
  return DECIMAL.test(value) ? Number(value) : undefined;
}

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** AI fields count as read ("high"); the cross-validation lowers what does not add up. */
function field<T>(value: T | undefined) {
  return value === undefined ? undefined : { value, confidence: 'high' as const };
}

export interface AiExtraction {
  extraction: ExtractedInvoice;
  providerName?: string;
}

/** Converts the model's answer into the parsers' format (src/parsers/types.ts). */
export function toExtraction(response: ExtractResponse): AiExtraction {
  const extraction: ExtractedInvoice = {
    sector: response.sector as Sector,
    lines: [],
    readings: [],
    warnings: [],
    linesIncludeVat: response.linesIncludeVat,
  };
  const set = <K extends keyof ExtractedInvoice>(
    key: K,
    value: ExtractedInvoice[K] | undefined,
  ) => {
    if (value !== undefined) extraction[key] = value;
  };
  set('docId', field(text(response.docId)));
  set('issueDate', field(validDate(response.issueDate)));
  set('periodStart', field(validDate(response.periodStart)));
  set('periodEnd', field(validDate(response.periodEnd)));
  set('dueDate', field(validDate(response.dueDate)));
  set('loyaltyEndDate', field(validDate(response.loyaltyEndDate)));
  set('totalCents', field(cents(response.total)));
  set('netCents', field(cents(response.net)));
  set('vatCents', field(cents(response.vat)));
  set('customerNumber', field(text(response.customerNumber)));
  set('supplyPointId', field(text(response.supplyPointId)));
  set('tariffName', field(text(response.tariffName)));
  set('powerKva', field(decimal(response.powerKva)));
  if (response.readingType) set('readingType', field(response.readingType));

  for (const line of response.lines) {
    const amountCents = cents(line.amount);
    if (amountCents === undefined) {
      extraction.warnings.push(`Linha sem valor legível: ${line.description}`);
      continue;
    }
    const out: ExtractedLine = {
      kind: line.kind as InvoiceLine['kind'],
      description: line.description.trim(),
      amountCents,
    };
    const quantity = decimal(line.quantity);
    if (quantity !== undefined) out.quantity = quantity;
    if (line.unit) out.unit = line.unit;
    if (line.period) out.period = line.period;
    const vatRate = decimal(line.vatRate);
    if (vatRate !== undefined) out.vatRate = vatRate;
    if (line.basis) out.basis = line.basis;
    extraction.lines.push(out);
  }

  for (const reading of response.readings) {
    const quantity = decimal(reading.quantity);
    const dateTo = validDate(reading.dateTo);
    if (quantity === undefined || !dateTo) continue;
    const out: ExtractedReading = {
      quantity,
      unit: reading.unit,
      readingType: reading.readingType as Reading['readingType'],
      dateTo,
    };
    if (reading.period) out.period = reading.period;
    extraction.readings.push(out);
  }

  const providerName = text(response.providerName);
  return { extraction, ...(providerName ? { providerName } : {}) };
}
