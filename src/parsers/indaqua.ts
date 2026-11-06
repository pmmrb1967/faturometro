/**
 * Indaqua Matosinhos (water and sanitation). One PDF holds two invoices, each
 * with its own QR code: Indaqua's (water, sanitation, water resources tax) and
 * the Município de Matosinhos' (urban waste, not subject to VAT). Page 1 has the
 * invoice numbers, billing period, issue date and due date; page 2 the meter
 * reading and one "DETALHE DA FATURA N.º" block per invoice. Layout studied on
 * 2026 invoices (bimonthly billing). After an estimated month the detail takes
 * one page per month (pages 2 and 3), each with a block per invoice: the
 * second has the real reading, the "Acerto Per. Anterior" lines that undo the
 * estimate (billed and value only, negative) and the VAT summary.
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
  page: PageText;
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
    return { page, printed, totalCents: amount(total?.str), rows: all.slice(index + 1, end) };
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
  // "Acerto Per. Anterior": billed and value only (negative), without unit price.
  const adjustment = /Acerto Per\. Anterior/.test(row.text);
  const [billedItem, priceItem, valueItem] = adjustment
    ? [numbers.at(-2), undefined, numbers.at(-1)]
    : numbers.slice(-3);
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
  const basis = adjustment
    ? 'adjustment'
    : row.items.map((item) => readingTypeOf(item.str)).find(Boolean);
  if (basis) line.basis = basis;
  return line;
}

/**
 * Adds the block's lines to the result and its VAT summary to `vat`; returns
 * its first section's name ("Água", "Resíduos").
 */
function parseBlock(block: Block, result: ExtractedInvoice, vat: number[]): string {
  const isBilled = (item: TextItem) => /^Faturado$/.test(normalize(item.str));
  const header = block.rows.find((row) => row.items.some(isBilled));
  const billedX = header?.items.find(isBilled)?.x;
  if (!header || billedX === undefined) {
    result.warnings.push('Detail columns not found');
    return '';
  }
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
  return section;
}

/** Net and VAT from the lines and VAT summaries of every block, against the printed total. */
function totals(result: ExtractedInvoice, vat: number[], totalCents: number | null) {
  const net = sumCents(result.lines.map((line) => line.amountCents));
  const vatTotal = sumCents(vat);
  result.netCents = { value: net, confidence: 'high' };
  result.vatCents = { value: vatTotal, confidence: 'high' };
  if (totalCents !== null) {
    result.totalCents = { value: totalCents, confidence: 'high' };
    if (net + vatTotal !== totalCents) {
      result.warnings.push(`Lines ${net} + VAT ${vatTotal} ≠ total ${totalCents}`);
    }
  }
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
  // Only on invoices paid by direct debit (the others advertise it in other words).
  const debit = date(
    /^Data de Débito em Conta: A partir de: (\S+)$/.exec(
      normalize(findItem(page, /^Data de Débito em Conta:/)?.str ?? ''),
    )?.[1],
  );
  if (debit) result.directDebitDate = { value: debit, confidence: 'high' };
  const account = /N\.º de conta contrato: (\S+)/.exec(
    normalize(findItem(page, /N\.º de conta contrato:/)?.str ?? ''),
  )?.[1];
  if (account) result.customerNumber = { value: account, confidence: 'high' };
}

/** "COMUNICAÇÃO DA LEITURA" box: "Período ideal: de 30.07.2026 às 17h30 de 04.08.2026". */
function parseReadingWindow(pages: PageText[], result: ExtractedInvoice) {
  for (const page of pages) {
    const match = /^Período ideal: de (\S+) .*\bde (\S+)$/.exec(
      normalize(findItem(page, /^Período ideal: /)?.str ?? ''),
    );
    const start = date(match?.[1]);
    const end = date(match?.[2]);
    if (start && end && start <= end) {
      result.readingWindow = { value: { start, end }, confidence: 'high' };
      return;
    }
  }
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
  version: '1.3.0',
  updated: '2026-11-06',
  sectors: ['water'],
  issuerNifs: [INDAQUA_NIF, MUNICIPALITY_NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /INDAQUA Matosinhos/.test(text) && /DETALHE DA FATURA N\.º/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'water';
    const summaryPage = ctx.pages.find((page) => findItem(page, /^N\.º fatura: /));
    const blocks = ctx.pages.filter((page) => findItem(page, DETAIL)).flatMap(detailBlocks);
    const first = qr ? blocks.find((candidate) => matchesDocId(candidate.printed, qr)) : blocks[0];
    if (!first) {
      result.warnings.push('Invoice detail not found');
      return result;
    }
    result.docId = { value: qr?.docId ? normalize(qr.docId) : first.printed, confidence: 'high' };

    // The same invoice on every detail page (one page per month).
    const own = blocks.filter((block) => block.printed === first.printed);
    const vat: number[] = [];
    const sections = own.map((block) => parseBlock(block, result, vat));
    const section = sections.find(Boolean) ?? '';
    totals(result, vat, first.totalCents);
    if (summaryPage) parseSummary(summaryPage, first.printed, result);
    // The latest meter table: the page of the last month.
    const detailPage = own.at(-1)!.page;

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
      parseReadingWindow(ctx.pages, result);
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
