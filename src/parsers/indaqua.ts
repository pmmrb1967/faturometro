/**
 * Indaqua Matosinhos (water and sanitation). One PDF holds two invoices, each
 * with its own QR code: Indaqua's (water, sanitation, water resources tax) and
 * the Município de Matosinhos' (urban waste, not subject to VAT). Page 1 has the
 * invoice numbers, billing period, issue date and due date; page 2 the meter
 * reading and one "DETALHE DA FATURA N.º" block per invoice. Layout studied on
 * 2026 invoices (bimonthly billing).
 */
import type { InvoiceLine, Reading } from '../domain/types';
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
  type Row,
} from './utils';

const ID = 'indaqua';
/** Field A of the QR codes (fixtures): Indaqua Matosinhos, and the municipality (waste). */
const INDAQUA_NIF = '506925005';
const MUNICIPALITY_NIF = '501305912';

const DETAIL = /^DETALHE DA FATURA N\.º$/;
const PERCENT = /^(\d+)%$/;
const ORDINAL = /^\d+º$/;
const VOLUME = /^(\d+(?:,\d+)?) m$/;

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

/** "FA K4026FA/06091253" (QR field G) ends with the number printed on the invoice. */
function matchesDocId(printed: string, qr?: FiscalQr): boolean {
  if (!qr?.docId || !printed) return false;
  const docId = normalize(qr.docId);
  return docId === printed || docId.endsWith(` ${printed}`);
}

function readingTypeOf(text: string): Reading['readingType'] | undefined {
  const clean = normalize(text);
  if (/^real$/i.test(clean)) return 'real';
  if (/^estimad[oa]$|^estimativa$/i.test(clean)) return 'estimated';
  return undefined;
}

/** "04.03.2026" (only full dates; "15 m" or "0,1565" are not). */
function dateOf(item: TextItem): string | null {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(normalize(item.str)) ? date(item.str) : null;
}

interface Block {
  /** Invoice number as printed ("K4026FA/06091253"). */
  printed: string;
  totalCents: number | null;
  rows: Row[];
}

/** One block per invoice on the detail page: its header row, then the rows down to the next one. */
function detailBlocks(page: PageText): Block[] {
  const all = rows(page);
  const starts = all
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.items.some((item) => DETAIL.test(normalize(item.str))));
  return starts.map(({ row, index }, n) => {
    const header = row.items.find((item) => DETAIL.test(normalize(item.str)));
    const printed = normalize(row.items.find((item) => header && item.x > header.x)?.str ?? '');
    const total = [...row.items].reverse().find((item) => amount(item.str) !== null);
    const end = starts[n + 1]?.index ?? all.length;
    return { printed, totalCents: amount(total?.str), rows: all.slice(index + 1, end) };
  });
}

function lineKind(description: string, perDay: boolean): InvoiceLine['kind'] {
  if (/^Taxa /i.test(description)) return 'tax';
  return perDay ? 'base_fee' : 'usage';
}

/**
 * Columns: description | escalão | start | end | origin | explanation |
 * billed | unit price | value | VAT. Values are right-aligned and the "³" of
 * "m³" is a separate item, so fields are told apart by content and order:
 * from the "Faturado" column on, the last three numbers are billed, unit
 * price and value.
 */
function parseLine(row: Row, billedX: number): ExtractedLine | null {
  const dates = row.items.filter((item) => dateOf(item));
  const first = row.items[0];
  if (dates.length < 2 || !first) return null;
  const description = normalize(first.str);
  const tail = row.items.filter((item) => item.x >= billedX - 15);
  const numbers = tail.filter((item) => quantity(item.str) !== null);
  const [billedItem, priceItem, valueItem] = numbers.slice(-3);
  const value = amount(valueItem?.str);
  if (value === null) return null;
  const perDay = /Tar d = Tar m/.test(row.text);
  const ordinal = row.items.find((item) => ORDINAL.test(normalize(item.str)));
  const line: ExtractedLine = {
    kind: lineKind(description, perDay),
    description: ordinal ? `${description} (${normalize(ordinal.str)} escalão)` : description,
    amountCents: value,
    unit: perDay ? 'day' : 'm3',
  };
  const billed = quantity(billedItem?.str ?? '');
  if (billed !== null) line.quantity = billed;
  const unitPrice = decimalString(priceItem?.str ?? '');
  if (unitPrice) line.unitPrice = unitPrice;
  const rate = tail.map((item) => PERCENT.exec(normalize(item.str))?.[1]).find(Boolean);
  if (rate) line.vatRate = Number(rate);
  const basis = row.items.map((item) => readingTypeOf(item.str)).find(Boolean);
  if (basis) line.basis = basis;
  return line;
}

/** Fills lines and totals from the block; returns its first section's name ("Água", "Resíduos"). */
function parseBlock(block: Block, result: ExtractedInvoice): string {
  const isBilled = (item: TextItem) => /^Faturado$/.test(normalize(item.str));
  const header = block.rows.find((row) => row.items.some(isBilled));
  const billedX = header?.items.find(isBilled)?.x;
  if (!header || billedX === undefined) {
    result.warnings.push('Detail columns not found');
    return '';
  }
  const vat: number[] = [];
  let section = '';
  for (const row of block.rows) {
    if (row === header) continue;
    const description = normalize(row.items[0]?.str ?? '');
    // VAT summary: "6% | 1,86".
    if (PERCENT.test(description)) {
      const value = amount(row.items.at(-1)?.str);
      if (value !== null) vat.push(value);
      continue;
    }
    const line = parseLine(row, billedX);
    if (line) {
      result.lines.push(line);
      continue;
    }
    // Section header: "Água (medição)", "Resíduos (indexação volume água)".
    const name = description.replace(/\(.*$/, '').trim();
    if (!section && /\p{L}/u.test(name) && !/^IVA$/.test(name)) section = name;
  }

  const net = sumCents(result.lines.map((line) => line.amountCents));
  const vatTotal = sumCents(vat);
  result.netCents = { value: net, confidence: 'high' };
  result.vatCents = { value: vatTotal, confidence: 'high' };
  if (block.totalCents !== null) {
    result.totalCents = { value: block.totalCents, confidence: 'high' };
    if (net + vatTotal !== block.totalCents) {
      result.warnings.push(`Lines ${net} + VAT ${vatTotal} ≠ total ${block.totalCents}`);
    }
  }
  return section;
}

/**
 * Meter table: "Água- <meter> | previous | current | type | measured m³ |
 * estimated m³ (period) | estimated m³ (accumulated)", with the dates of the
 * previous and current readings just above.
 */
function parseReadings(page: PageText, result: ExtractedInvoice) {
  const all = rows(page);
  const header = all.find((row) =>
    row.items.some((item) => /^Contador n\.º$/.test(normalize(item.str))),
  );
  if (!header) return;
  const below = all.filter((row) => row.y > header.y && row.y - header.y < 40);
  const dateTo = below
    .flatMap((row) => row.items)
    .map(dateOf)
    .filter((value): value is string => value !== null)
    .at(-1);
  for (const row of below) {
    if (!/^Água-/.test(normalize(row.items[0]?.str ?? ''))) continue;
    const typeItem = row.items.find((item) => readingTypeOf(item.str));
    const readingType = typeItem ? readingTypeOf(typeItem.str) : undefined;
    if (!typeItem || !readingType || !dateTo) continue;
    const [measured = 0, estimatedPeriod = 0] = row.items
      .map((item) => VOLUME.exec(normalize(item.str))?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => quantity(value) ?? 0);
    const indexes = row.items
      .slice(1)
      .filter((item) => item.x < typeItem.x && quantity(item.str) !== null);
    const reading: ExtractedInvoice['readings'][number] = {
      quantity: measured + estimatedPeriod,
      unit: 'm3',
      readingType,
      dateTo,
    };
    const current = quantity(indexes.at(-1)?.str ?? '');
    if (current !== null) reading.meterReading = current;
    result.readings.push(reading);
  }
}

/** Page 1 row "N.º fatura: <number> * | Período de faturação: a a b | Data de emissão: c". */
function parseSummary(page: PageText, printed: string, result: ExtractedInvoice) {
  const row = rows(page).find((candidate) =>
    candidate.items.some((item) => normalize(item.str).startsWith(`N.º fatura: ${printed}`)),
  );
  const text = row?.text ?? '';
  const period = /Período de faturação: (\S+) a (\S+)/.exec(text);
  const start = date(period?.[1]);
  const end = date(period?.[2]);
  if (start && end) {
    result.periodStart = { value: start, confidence: 'high' };
    result.periodEnd = { value: end, confidence: 'high' };
  }
  const issue = date(/Data de emissão: (\S+)/.exec(text)?.[1]);
  if (issue) result.issueDate = { value: issue, confidence: 'high' };

  const due = date(/^Até: (\S+)$/.exec(normalize(findItem(page, /^Até: /)?.str ?? ''))?.[1]);
  if (due) result.dueDate = { value: due, confidence: 'high' };
  const account = /N\.º de conta contrato: (\S+)/.exec(
    normalize(findItem(page, /N\.º de conta contrato:/)?.str ?? ''),
  )?.[1];
  if (account) result.customerNumber = { value: account, confidence: 'high' };
}

/** The issuer's name as printed in the page 1 footer ("Município de Matosinhos | … | N.I.P.C. 501 305 912"). */
function issuerName(page: PageText, nif: string): string | undefined {
  const spaced = nif.replace(/(\d{3})(?=\d)/g, '$1 ');
  const item = page.items.find((candidate) =>
    normalize(candidate.str).includes(`N.I.P.C. ${spaced}`),
  );
  const name = item ? normalize(item.str).split(' | ')[0]?.trim() : undefined;
  return name || undefined;
}

export const indaquaParser: Parser = {
  id: ID,
  name: 'Indaqua Matosinhos',
  version: '1.0.0',
  sectors: ['water'],
  issuerNifs: [INDAQUA_NIF, MUNICIPALITY_NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /INDAQUA Matosinhos/.test(text) && /DETALHE DA FATURA N\.º/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'water';
    const detailPage = ctx.pages.find((page) => findItem(page, DETAIL));
    const summaryPage = ctx.pages.find((page) => findItem(page, /^N\.º fatura: /));
    const blocks = detailPage ? detailBlocks(detailPage) : [];
    const block = qr ? blocks.find((candidate) => matchesDocId(candidate.printed, qr)) : blocks[0];
    if (!detailPage || !block) {
      result.warnings.push('Invoice detail not found');
      return result;
    }
    result.docId = { value: qr?.docId ? normalize(qr.docId) : block.printed, confidence: 'high' };

    const section = parseBlock(block, result);
    if (summaryPage) parseSummary(summaryPage, block.printed, result);

    const isWater = result.lines.some((line) => /^Tarifa de Venda de Água/.test(line.description));
    if (isWater) {
      parseReadings(detailPage, result);
      if (result.readings.length > 0) {
        const estimated = result.readings.some((reading) => reading.readingType === 'estimated');
        result.readingType = { value: estimated ? 'estimated' : 'real', confidence: 'high' };
      }
      const tariff = /^Tarifa: (.+)$/.exec(
        normalize(findItem(detailPage, /^Tarifa: /)?.str ?? ''),
      )?.[1];
      if (tariff) result.tariffName = { value: tariff, confidence: 'high' };
    } else if (section) {
      // Another service billed in the same document (urban waste): its own contract.
      result.contractLabel = { value: section, confidence: 'high' };
    }
    if (qr && qr.issuerNif !== INDAQUA_NIF && summaryPage) {
      const name = issuerName(summaryPage, qr.issuerNif);
      if (name) result.issuerName = { value: name, confidence: 'high' };
    }
    return result;
  },
};
