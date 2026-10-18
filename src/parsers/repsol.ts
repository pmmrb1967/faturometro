/**
 * Repsol (electricity and natural gas). One PDF holds a summary page, one
 * page per invoice (electricity, gas — each with its own QR code) and a
 * contract data page. Layout studied on 2026 invoices.
 */
import type { ConsumptionPeriod, InvoiceLine, Reading } from '../domain/types';
import { sumCents } from '../lib/money';
import type { PageText, TextItem } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import {
  emptyExtraction,
  type ExtractedInvoice,
  type ExtractedLine,
  type Parser,
  type ParserContext,
} from './types';
import {
  amount,
  date,
  decimalString,
  findItem,
  normalize,
  quantity,
  rows,
  valueBelow,
  valueRightOf,
} from './utils';

const ID = 'repsol';
/** Field A of the QR code on Repsol invoices (fixtures). */
const NIF = '500246963';

const PERIODS: [RegExp, ConsumptionPeriod][] = [
  [/fora de vazio/i, 'off_empty'],
  [/vazio/i, 'empty'],
  [/cheias?/i, 'full'],
  [/ponta/i, 'peak'],
];

const UNITS: Record<string, NonNullable<InvoiceLine['unit']>> = {
  kwh: 'kWh',
  dias: 'day',
  dia: 'day',
  meses: 'month',
  mês: 'month',
  m3: 'm3',
};

function periodOf(text: string): ConsumptionPeriod | undefined {
  return PERIODS.find(([pattern]) => pattern.test(text))?.[1];
}

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

/** The page of the invoice whose QR code is `qr` (its document id is printed on it). */
function invoicePage(pages: PageText[], qr?: FiscalQr): PageText | undefined {
  const withPeriod = pages.filter((page) => findItem(page, /^Período Faturação:/));
  if (qr?.docId) {
    const docId = normalize(qr.docId);
    const match = withPeriod.find((page) =>
      page.items.some((item) => normalize(item.str) === docId),
    );
    if (match) return match;
  }
  return withPeriod[0];
}

function readingTypeOf(text: string): Reading['readingType'] | undefined {
  if (/^real$/i.test(text)) return 'real';
  if (/^estimad[oa]$/i.test(text)) return 'estimated';
  return undefined;
}

function parseReadings(page: PageText, result: ExtractedInvoice) {
  const header = findItem(page, /^Tipo de Consumo$/);
  const linesHeader = findItem(page, /^Descrição$/);
  const leituraHeader = findItem(page, /^Leitura$/);
  if (!header || !linesHeader) return;
  for (const row of rows(page)) {
    if (row.y <= header.y + 1 || row.y >= linesHeader.y) continue;
    const unitIndex = row.items.findIndex((item) => /^kWh$/i.test(item.str.trim()));
    const value = unitIndex > 0 ? quantity(row.items[unitIndex - 1]?.str ?? '') : null;
    const kind = row.items.find((item) => Math.abs(item.x - header.x) <= 6)?.str ?? '';
    const readingType = row.items.map((item) => readingTypeOf(item.str.trim())).find(Boolean);
    const dateTo = row.items.map((item) => date(item.str)).find(Boolean);
    if (value === null || !readingType || !dateTo) continue;
    const reading: ExtractedInvoice['readings'][number] = {
      quantity: value,
      unit: 'kWh',
      readingType,
      dateTo,
    };
    const period = periodOf(kind);
    if (period) reading.period = period;
    const meter = leituraHeader
      ? row.items.find((item) => Math.abs(item.x - leituraHeader.x) <= 6)
      : undefined;
    const meterValue = meter ? quantity(meter.str) : null;
    if (meterValue !== null) reading.meterReading = meterValue;
    result.readings.push(reading);

    const power = row.items.find((item) => /^\d+,\d+\s*kVA$/i.test(item.str.trim()));
    if (power && !result.powerKva) {
      const kva = quantity(power.str.replace(/kVA/i, ''));
      if (kva !== null) result.powerKva = { value: kva, confidence: 'high' };
    }
  }
}

const EXPLANATION =
  /^(-?[\d.]+(?:,\d+)?) (kWh|dias|dia|meses|mês|m3) x (-?\d+(?:,\d+)?) €\/(kWh|dia|mês|m3)$/i;

function lineKind(description: string, section: string): InvoiceLine['kind'] {
  if (/^desc\./i.test(description)) return 'discount';
  if (/taxas e impostos/i.test(section)) return 'tax';
  if (/potência|termo fixo/i.test(description)) return 'power';
  if (/energia/i.test(description)) return 'energy';
  return 'other';
}

function parseLines(page: PageText, result: ExtractedInvoice) {
  const header = findItem(page, /^Descrição$/);
  const valueHeader = findItem(page, /^Valor\(€\)$/);
  const netRow = rows(page).find((row) => /^Total sem IVA/.test(row.text));
  if (!header || !valueHeader || !netRow) {
    result.warnings.push('Invoice lines table not found');
    return;
  }

  const vat: number[] = [];
  let section = '';
  for (const row of rows(page)) {
    if (row.y <= header.y + 1 || row.y >= netRow.y) continue;
    const description = row.items.find((item) => item.x < 190 && /\p{L}/u.test(item.str));
    if (!description) continue;
    const name = normalize(description.str);
    const valueItem = row.items.find(
      (item) =>
        item.x > valueHeader.x - 10 && item.x < valueHeader.x + 25 && amount(item.str) !== null,
    );
    if (!valueItem) {
      section = name;
      continue;
    }
    const cents = amount(valueItem.str) ?? 0;
    const vatMatch = /^\([a-z]\) IVA (\d+)%$/i.exec(name);
    if (vatMatch) {
      vat.push(cents);
      continue;
    }
    const line: ExtractedLine = {
      kind: lineKind(name, section),
      description: name,
      amountCents: cents,
    };
    // Second column: Real / Estimado / Acerto (adjustment of earlier estimates).
    const basisText = row.items.find((item) => item.x > 190 && item.x < 225)?.str.trim() ?? '';
    const basis = /^acerto$/i.test(basisText) ? 'adjustment' : readingTypeOf(basisText);
    if (basis) line.basis = basis;
    const explanation = row.items.find((item) => EXPLANATION.test(normalize(item.str)));
    const match = explanation ? EXPLANATION.exec(normalize(explanation.str)) : null;
    if (match) {
      const qty = quantity(match[1] ?? '');
      const unit = UNITS[(match[2] ?? '').toLowerCase()];
      const unitPrice = decimalString(match[3] ?? '');
      if (qty !== null) line.quantity = qty;
      if (unit) line.unit = unit;
      if (unitPrice) line.unitPrice = unitPrice;
    }
    const period = line.kind === 'energy' || line.kind === 'discount' ? periodOf(name) : undefined;
    if (period) line.period = period;
    result.lines.push(line);
  }

  const net = amount(netRow.items.find((item) => amount(item.str) !== null)?.str);
  const totalRow = rows(page).find((row) => /^TOTAL\b/.test(row.text));
  const total = amount(totalRow?.items.find((item) => amount(item.str) !== null)?.str);
  if (net !== null) result.netCents = { value: net, confidence: 'high' };
  if (total !== null) result.totalCents = { value: total, confidence: 'high' };
  if (vat.length > 0) result.vatCents = { value: sumCents(vat), confidence: 'high' };

  const linesTotal = sumCents(result.lines.map((line) => line.amountCents));
  if (net !== null && linesTotal !== net) {
    result.warnings.push(`Lines add up to ${linesTotal}, net total is ${net}`);
  }
}

function labelValue(
  page: PageText | undefined,
  label: RegExp,
  position: 'below' | 'right',
): TextItem | undefined {
  if (!page) return undefined;
  const item = findItem(page, label);
  if (!item) return undefined;
  return position === 'below' ? valueBelow(page, item, 20) : valueRightOf(page, item);
}

/** "Escalão 2" on a gas invoice page → 2. */
export function escalaoOf(page: PageText): 1 | 2 | 3 | 4 | undefined {
  const item = page.items.find((candidate) => /^Escalão [1-4]$/.test(normalize(candidate.str)));
  const value = item ? Number(normalize(item.str).slice(-1)) : NaN;
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined;
}

export const repsolParser: Parser = {
  id: ID,
  name: 'Repsol',
  version: '1.3.0',
  updated: '2026-10-18',
  sectors: ['electricity', 'gas'],
  issuerNifs: [NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /Repsol Portuguesa/.test(text) && /Período Faturação:/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    const page = invoicePage(ctx.pages, qr);
    if (!page) {
      result.warnings.push('Invoice page not found');
      return result;
    }
    const isGas = Boolean(findItem(page, /^Escalão$/));
    result.sector = isGas ? 'gas' : 'electricity';
    const escalao = isGas ? escalaoOf(page) : undefined;
    if (escalao) result.gasEscalao = { value: escalao, confidence: 'high' };

    const docId = labelValue(page, /^Fatura$/, 'below');
    if (docId) result.docId = { value: normalize(docId.str), confidence: 'high' };

    const tariff = labelValue(page, /^Tarifa$/, 'below');
    if (tariff) result.tariffName = { value: normalize(tariff.str), confidence: 'high' };

    const period = findItem(page, /^Período Faturação:/);
    const periodMatch = period && /(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})/.exec(period.str);
    if (periodMatch?.[1] && periodMatch[2]) {
      result.periodStart = { value: periodMatch[1], confidence: 'high' };
      result.periodEnd = { value: periodMatch[2], confidence: 'high' };
    }

    parseReadings(page, result);
    parseLines(page, result);
    if (result.readings.length > 0) {
      const estimated = result.readings.some((reading) => reading.readingType === 'estimated');
      result.readingType = { value: estimated ? 'estimated' : 'real', confidence: 'high' };
    }

    // Summary page: customer number and direct debit date.
    const summary = ctx.pages.find((candidate) => findItem(candidate, /^Resumo de faturação$/));
    const customer = labelValue(summary, /^Cliente \/ Conta:$/, 'right');
    if (customer) result.customerNumber = { value: normalize(customer.str), confidence: 'high' };
    const debit = labelValue(summary, /^Débito a partir de$/, 'below');
    const due = date(debit?.str);
    if (due) {
      result.dueDate = { value: due, confidence: 'high' };
      // "Débito a partir de": the invoice is presented to the bank on that day.
      result.directDebitDate = { value: due, confidence: 'high' };
    }

    // Contract data page: CPE (electricity) or CUI (gas).
    const contractPage = ctx.pages.find((candidate) => findItem(candidate, /^Dados da Conta$/));
    const pointLabel = isGas
      ? /^CUI \(Código Universal Instalação\)$/
      : /^CPE \(Código Ponto Entrega\)$/;
    const point = labelValue(contractPage, pointLabel, 'below');
    if (point)
      result.supplyPointId = { value: normalize(point.str).replace(/ /g, ''), confidence: 'high' };

    return result;
  },
};
