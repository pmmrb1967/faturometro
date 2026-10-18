/**
 * Águas do Porto (CMPEAE, water and sanitation). One PDF holds two invoices,
 * each with its own QR code: the company's (water, sanitation, water resources
 * tax; 6 % VAT) and the one for urban waste (another NIF, not subject to VAT),
 * billed in the same document. Page 1 has the account and the due date; page 2
 * the meter reading and one block per invoice ("Fatura | <number>", "Data de
 * Fatura", "Período", then the detail lines). Layout studied on 2026 invoices
 * (monthly billing, telemetry readings).
 */
import type { Reading } from '../domain/types';
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
  type Row,
} from './utils';

const ID = 'aguas-porto';
/** Field A of the QR codes (fixtures): the water company, and the urban waste invoice. */
const WATER_NIF = '507718666';
const WASTE_NIF = '514280956';

/** "2026-08-14 2026-09-10" in the "Período" column of a detail line. */
const LINE_PERIOD = /^\d{4}-\d{2}-\d{2} \d{4}-\d{2}-\d{2}$/;
/** "2026-08-14 ~ 2026-09-10" under "Período" in the block header. */
const BLOCK_PERIOD = /^(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})$/;
/** VAT note of a line, "(2)", and its explanation below the lines, "(2)IVA 6%". */
const NOTE = /^\((\d+)\)$/;
const NOTE_RATE = /^\((\d+)\)\s*IVA (\d+)%$/;

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

function sameNumber(printed: string, qr?: FiscalQr): boolean {
  if (!qr?.docId || !printed) return false;
  const docId = normalize(qr.docId);
  return docId === printed || docId.endsWith(` ${printed}`);
}

interface Block {
  /** Invoice number as printed ("93691145"). */
  printed: string;
  rows: Row[];
}

/** One block per invoice on the detail page: from its "Fatura" header to the next one. */
function detailBlocks(page: PageText): Block[] {
  const all = rows(page);
  const starts = all
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        normalize(row.items[0]?.str ?? '') === 'Fatura' && row.text.includes('Tipo de Cliente'),
    );
  return starts.map(({ row, index }, n) => {
    const label = row.items[0]!;
    const number = all[index + 1]?.items.find((item) => Math.abs(item.x - label.x) < 10);
    const end = starts[n + 1]?.index ?? all.length;
    return { printed: normalize(number?.str ?? ''), rows: all.slice(index + 1, end) };
  });
}

/** The value below a header label of the block ("Data de Fatura", "Tarifa", "Período"). */
function headerValue(block: Block, label: RegExp): string | undefined {
  const index = block.rows.findIndex((row) =>
    row.items.some((item) => label.test(normalize(item.str))),
  );
  const header = block.rows[index]?.items.find((item) => label.test(normalize(item.str)));
  const value =
    header && block.rows[index + 1]?.items.find((item) => Math.abs(item.x - header.x) < 10);
  return value ? normalize(value.str) : undefined;
}

function lineKind(description: string): ExtractedLine['kind'] {
  if (/Disp|Dispon/i.test(description)) return 'base_fee';
  if (/^(Taxa|TRH|Tx|EA9)\b/i.test(description) || /Taxa|Tx Gest/i.test(description)) return 'tax';
  if (/Juros/i.test(description)) return 'other';
  return 'usage';
}

/**
 * "Faturado" column: "3,0000" with "m3 em 28 dias" beside it, "3 m3 em 28 dias",
 * "2.7 m3" (water) or "28 dias" (fixed fees). Anything else (late interest
 * shows a reference number there) has no quantity.
 */
function billed(items: TextItem[]): Pick<ExtractedLine, 'quantity' | 'unit'> {
  const text = items.map((item) => normalize(item.str)).join(' ');
  const volume = /^(\d+(?:[.,]\d+)?) ?m3\b/i.exec(text);
  if (volume) return { quantity: quantity(volume[1]!.replace('.', ',')) ?? undefined, unit: 'm3' };
  const days = /^(\d+) dias$/.exec(text);
  if (days) return { quantity: Number(days[1]), unit: 'day' };
  return {};
}

interface Columns {
  billedX: number;
  priceX: number;
  valueX: number;
  vatX: number;
}

function columnsOf(row: Row): Columns | null {
  const x = (label: string) => row.items.find((item) => normalize(item.str) === label)?.x;
  const [billedX, priceX, valueX, vatX] = [x('Faturado'), x('Valor Unit.'), x('Valor'), x('IVA')];
  if (billedX === undefined || priceX === undefined || valueX === undefined || vatX === undefined) {
    return null;
  }
  return { billedX, priceX, valueX, vatX };
}

/** Fills lines and totals from the block; returns its first section ("ÁGUA", "RESÍDUOS URBANOS"). */
function parseBlock(block: Block, result: ExtractedInvoice): string {
  const headerIndex = block.rows.findIndex((row) => columnsOf(row));
  const columns = headerIndex >= 0 ? columnsOf(block.rows[headerIndex]!) : null;
  if (!columns) {
    result.warnings.push('Detail columns not found');
    return '';
  }
  const rates = new Map<string, number>();
  const notes: (string | undefined)[] = [];
  let section = '';
  let vat: number | null = null;
  let net: number | null = null;
  let total: number | null = null;
  // Values are right-aligned: the value column holds items between "Valor" and "IVA".
  const inValue = (item: TextItem) => item.x >= columns.valueX - 10 && item.x < columns.vatX - 5;

  for (const row of block.rows.slice(headerIndex + 1)) {
    const first = normalize(row.items[0]?.str ?? '');
    const valueItem = row.items.find(inValue);
    if (/^Total sem IVA$/i.test(first)) net = amount(valueItem?.str);
    if (/^TOTAL$/.test(first)) total = amount(valueItem?.str);
    if (/^(TOTAL|Total sem IVA)$/i.test(first)) continue;
    const rate = NOTE_RATE.exec(first);
    if (rate) {
      rates.set(rate[1]!, Number(rate[2]));
      continue;
    }
    if (/^\(\d+\)/.test(first)) continue;
    const period = row.items.find((item) => LINE_PERIOD.test(normalize(item.str)));
    if (!period) {
      // Section header: "ÁGUA | 4,96", "IVA | 0,48".
      if (/^IVA$/.test(first)) vat = amount(valueItem?.str);
      else if (!section && /\p{L}/u.test(first) && valueItem) section = first;
      continue;
    }
    const value = amount(valueItem?.str);
    if (value === null) continue;
    const line: ExtractedLine = { kind: lineKind(first), description: first, amountCents: value };
    const quantityItems = row.items.filter(
      (item) => item.x >= columns.billedX - 10 && item.x < columns.priceX - 5,
    );
    const { quantity: billedQuantity, unit } = billed(quantityItems);
    if (billedQuantity !== undefined && unit) {
      line.quantity = billedQuantity;
      line.unit = unit;
    }
    const price = row.items.find((item) => Math.abs(item.x - columns.priceX) < 10);
    const unitPrice = decimalString(price?.str ?? '');
    if (unitPrice) line.unitPrice = unitPrice;
    result.lines.push(line);
    // The note may sit a few points above the line (late interest).
    notes.push(
      row.items.map((item) => NOTE.exec(normalize(item.str))?.[1]).find(Boolean) ??
        block.rows
          .filter((other) => other.y < row.y && row.y - other.y < 6)
          .flatMap((other) => other.items)
          .map((item) => NOTE.exec(normalize(item.str))?.[1])
          .find(Boolean),
    );
  }
  result.lines.forEach((line, index) => {
    const note = notes[index];
    const rate = note ? rates.get(note) : undefined;
    if (rate !== undefined) line.vatRate = rate;
  });

  const lines = sumCents(result.lines.map((line) => line.amountCents));
  result.netCents = { value: net ?? lines, confidence: 'high' };
  if (vat !== null) result.vatCents = { value: vat, confidence: 'high' };
  if (total !== null) result.totalCents = { value: total, confidence: 'high' };
  if (net !== null && lines !== net) result.warnings.push(`Lines ${lines} ≠ net ${net}`);
  if (net !== null && vat !== null && total !== null && net + vat !== total) {
    result.warnings.push(`Net ${net} + VAT ${vat} ≠ total ${total}`);
  }
  return section;
}

/**
 * Meter table: "<meter> | <diameter> | Consumo de Água | <previous date> | <previous index>",
 * then "<date> | Empresa | <index> | <factor> | Real | <m³> | M3" and "Estimado | <m³> M3".
 */
function parseReading(page: PageText, result: ExtractedInvoice) {
  const all = rows(page);
  const start = all.findIndex((row) =>
    row.items.some((item) => normalize(item.str) === 'Consumo de Água'),
  );
  if (start < 0) return;
  const current = all[start + 1];
  const estimatedRow = all[start + 2];
  const realIndex = current?.items.findIndex((item) => normalize(item.str) === 'Real') ?? -1;
  if (!current || realIndex < 0) return;
  const dateTo = date(current.items[0]?.str);
  const real = quantity(current.items[realIndex + 1]?.str ?? '');
  const estimated = estimatedRow?.text.startsWith('Estimado')
    ? quantity(/(\d+(?:,\d+)?) ?M3/.exec(estimatedRow.text)?.[1] ?? '')
    : null;
  if (!dateTo || real === null) return;
  const meter = current.items.slice(1, realIndex).map((item) => normalize(item.str));
  const index = quantity(meter.find((text) => /^\d+$/.test(text)) ?? '');
  const readingType: Reading['readingType'] = (estimated ?? 0) > 0 ? 'estimated' : 'real';
  const reading: ExtractedInvoice['readings'][number] = {
    quantity: real + (estimated ?? 0),
    unit: 'm3',
    readingType,
    dateTo,
  };
  if (index !== null) reading.meterReading = index;
  result.readings.push(reading);
  result.readingType = { value: readingType, confidence: 'high' };
}

/** Page 1: "Cliente / Conta: <client> / <account>" and the due date under "Pagar até". */
function parseSummary(page: PageText, result: ExtractedInvoice) {
  const label = findItem(page, /^Cliente \/ Conta:$/);
  const account =
    label &&
    rows(page)
      .find((row) => row.items.includes(label))
      ?.items.find((item) => item.x > label.x);
  if (account) result.customerNumber = { value: normalize(account.str), confidence: 'high' };
  const dueLabel = findItem(page, /^Pagar até$/);
  const due = date(dueLabel ? valueBelow(page, dueLabel)?.str : undefined);
  if (due) result.dueDate = { value: due, confidence: 'high' };
}

/** Page 1: "Período de Comunicação | 2026-10-09 ~ 2026-10-12" (days to send the meter reading). */
function parseReadingWindow(pages: PageText[], result: ExtractedInvoice) {
  for (const page of pages) {
    const label = findItem(page, /^Período de Comunicação$/);
    const value = label && valueRightOf(page, label);
    const match = BLOCK_PERIOD.exec(normalize(value?.str ?? ''));
    if (match && match[1]! <= match[2]!) {
      result.readingWindow = { value: { start: match[1]!, end: match[2]! }, confidence: 'high' };
      return;
    }
  }
}

export const aguasPortoParser: Parser = {
  id: ID,
  name: 'Águas do Porto',
  version: '1.1.0',
  updated: '2026-10-18',
  sectors: ['water'],
  issuerNifs: [WATER_NIF, WASTE_NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /Águas e Energia do Município do Porto/.test(text) && /Data de Fatura/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'water';
    const detailPage = ctx.pages.find((page) => findItem(page, /^Data de Fatura$/));
    const blocks = detailPage ? detailBlocks(detailPage) : [];
    const block = qr ? blocks.find((candidate) => sameNumber(candidate.printed, qr)) : blocks[0];
    if (!detailPage || !block) {
      result.warnings.push('Invoice detail not found');
      return result;
    }
    result.docId = { value: qr?.docId ? normalize(qr.docId) : block.printed, confidence: 'high' };
    const issue = date(headerValue(block, /^Data de Fatura$/));
    if (issue) result.issueDate = { value: issue, confidence: 'high' };
    const period = BLOCK_PERIOD.exec(headerValue(block, /^Período$/) ?? '');
    if (period) {
      result.periodStart = { value: period[1]!, confidence: 'high' };
      result.periodEnd = { value: period[2]!, confidence: 'high' };
    }

    const section = parseBlock(block, result);
    const summaryPage = ctx.pages.find((page) => findItem(page, /^Pagar até$/));
    if (summaryPage) parseSummary(summaryPage, result);

    if (/^ÁGUA$/i.test(section)) {
      parseReading(detailPage, result);
      // "710 - Doméstico".
      const tariff = headerValue(block, /^Tarifa$/)?.replace(/^\d+ - /, '');
      if (tariff) result.tariffName = { value: tariff, confidence: 'high' };
      parseReadingWindow(ctx.pages, result);
    } else if (/RES[IÍ]DUOS/i.test(section)) {
      // Urban waste billed in the same document: its own contract.
      result.contractLabel = { value: 'Resíduos', confidence: 'high' };
    }
    return result;
  },
};
