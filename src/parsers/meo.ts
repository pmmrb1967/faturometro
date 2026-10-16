/**
 * MEO (telecommunications). Page 1: header (labels at the left, values in a
 * second column), summary of the invoice without VAT, VAT and total, due date.
 * Page 2: billing detail per service (adhesion, monthly fees, discounts) with
 * the period each fee covers, the VAT summary and the loyalty period.
 * Layout studied on 2025 mobile-only invoices.
 *
 * Amounts have three decimals and a space after the comma ("15, 874"). Some
 * PDFs split every word, and even digits, into separate text items: values
 * are read from cells (items joined by their distance), not from single items.
 */
import { TELECOM_SERVICES, type InvoiceLine, type TelecomService } from '../domain/types';
import type { PageText, TextItem } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import {
  emptyExtraction,
  type ExtractedInvoice,
  type ExtractedLine,
  type Parser,
  type ParserContext,
} from './types';
import { date, dayMonthRange, normalize, rows } from './utils';

/** Field A of the QR code on MEO invoices (fixtures). */
const NIF = '504615947';

/** Items closer than this (points) belong to the same cell. */
const CELL_GAP = 8;

interface Cell {
  x: number;
  text: string;
}

interface CellRow {
  y: number;
  cells: Cell[];
  text: string;
}

/** A row's items joined into cells: a space between words, none inside a split word. */
function cellsOf(items: readonly TextItem[]): Cell[] {
  const cells: (Cell & { end: number })[] = [];
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    if (!item.str.trim()) continue;
    const last = cells.at(-1);
    const gap = last ? item.x - last.end : Infinity;
    if (last && gap < CELL_GAP) {
      // Words are ~1 pt apart; pieces of a split number touch (≤ 0,2 pt).
      last.text += (gap > 0.5 ? ' ' : '') + item.str.trim();
      last.end = Math.max(last.end, item.x + item.width);
    } else {
      cells.push({ x: item.x, text: item.str.trim(), end: item.x + item.width });
    }
  }
  return cells.map(({ x, text }) => ({ x, text: normalize(text) }));
}

/** Left margin with the company details printed vertically (one item per word in some PDFs). */
const MARGIN_X = 60;

function cellRows(page: PageText): CellRow[] {
  const content = { ...page, items: page.items.filter((item) => item.x >= MARGIN_X) };
  return rows(content).map((row) => {
    const cells = cellsOf(row.items);
    return { y: row.y, cells, text: cells.map((cell) => cell.text).join(' | ') };
  });
}

/** "15, 874", "€ 19, 36", "-0, 004" → thousandths of a euro. */
function milli(text: string | undefined): number | null {
  if (text === undefined) return null;
  const match = /^(-)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,3})$/.exec(
    text.replace(/€/g, '').replace(/\s+/g, ''),
  );
  if (!match) return null;
  const [, sign, integer = '', decimals = ''] = match;
  const value = Number(integer.replace(/\./g, '')) * 1000 + Number(decimals.padEnd(3, '0'));
  return sign ? -value : value;
}

const cents = (thousandths: number) => Math.round(thousandths / 10);

/** "22, 00" → 22. */
function rate(text: string | undefined): number | undefined {
  const value = milli(text);
  return value === null ? undefined : value / 1000;
}

/** "2026-04-04" also when split ("202", "6", "-", "0", "4", …). */
function dateOf(text: string | undefined): string | null {
  return date(text?.replace(/\s+/g, ''));
}

/** Header: "Label:" in the first column, value in the cell right of it. */
function headerValue(page: CellRow[], label: RegExp): string | undefined {
  for (const row of page) {
    const index = row.cells.findIndex((cell) => cell.x < 150 && label.test(cell.text));
    if (index < 0) continue;
    const value = row.cells[index + 1];
    if (value && value.x < 300) return value.text;
  }
  return undefined;
}

function parseHeader(page: CellRow[], result: ExtractedInvoice) {
  const docId = headerValue(page, /^Nº Fatura:$/);
  if (docId) result.docId = { value: docId, confidence: 'high' };

  const issue = dateOf(headerValue(page, /^Data de emissão:$/));
  if (issue) result.issueDate = { value: issue, confidence: 'high' };

  const account = headerValue(page, /^Nº Conta:$/)?.replace(/\s+/g, '');
  if (account) result.customerNumber = { value: account, confidence: 'high' };

  const tariff = headerValue(page, /^Tarifário$/);
  if (tariff) result.tariffName = { value: tariff, confidence: 'high' };

  // "Data Limite de Pagamento" heads a column; the date is on the next row.
  const labelRow = page.findIndex((row) =>
    row.cells.some((cell) => /^Data Limite de Pagamento$/.test(cell.text)),
  );
  const label = page[labelRow]?.cells.find((cell) => /^Data Limite/.test(cell.text));
  const next = page[labelRow + 1];
  if (label && next && next.y - (page[labelRow]?.y ?? 0) < 25) {
    const due = next.cells
      .filter((cell) => cell.x >= label.x - 10 && cell.x < label.x + 150)
      .map((cell) => dateOf(cell.text))
      .find((value) => value !== null);
    if (due) result.dueDate = { value: due, confidence: 'high' };
  }
}

/** "Valor total da fatura": net | VAT | total. */
function parseTotals(page: CellRow[], result: ExtractedInvoice): number | null {
  const row = page.find((candidate) => /^Valor total da fatura$/.test(candidate.cells[0]?.text ?? ''));
  const amounts = (row?.cells.slice(1) ?? []).map((cell) => milli(cell.text));
  if (!row || amounts.length !== 3 || amounts.some((value) => value === null)) {
    result.warnings.push('Invoice total not found');
    return null;
  }
  const [net = 0, vat = 0, total = 0] = amounts as number[];
  result.netCents = { value: cents(net), confidence: 'high' };
  result.vatCents = { value: cents(vat), confidence: 'high' };
  result.totalCents = { value: cents(total), confidence: 'high' };
  if (cents(net) + cents(vat) !== cents(total)) {
    result.warnings.push('Net and VAT do not add up to the total');
  }
  return net;
}

function kindOf(section: string, group: string, value: number): InvoiceLine['kind'] {
  if (value < 0) return 'discount';
  if (/^ades[õo]es$/i.test(section)) return 'other';
  if (/^mensalidades$/i.test(section)) return /^tarif[áa]rios$/i.test(group) ? 'base_fee' : 'addon';
  if (/equipamento/i.test(section)) return 'equipment';
  return 'other';
}

/** "01 fev a 28 fev", "01 abril a 30 abril" → "01 fev - 28 fev" for dayMonthRange. */
function rangeText(text: string): string | null {
  const match = /^(\d{1,2}) ([a-zç]+) a (\d{1,2}) ([a-zç]+)$/i.exec(text);
  if (!match) return null;
  const [, startDay, startMonth = '', endDay, endMonth = ''] = match;
  return `${startDay} ${startMonth.slice(0, 3)} - ${endDay} ${endMonth.slice(0, 3)}`;
}

/**
 * "DETALHE DE FATURAÇÃO": sections in capitals ("ADESÕES", "MENSALIDADES"),
 * the service number, groups ("Tarifários", "Descontos em Mensalidades") and
 * lines with period, value without VAT and VAT rate, down to "Total sem IVA".
 * Line amounts have three decimals: each line gets the cents that keep the
 * running total rounded, so the lines add up to the net total exactly.
 */
function parseDetail(pages: CellRow[][], reference: string | undefined, result: ExtractedInvoice) {
  for (const page of pages) {
    const start = page.findIndex((row) => /^DETALHE DE FATURAÇÃO$/.test(row.cells[0]?.text ?? ''));
    if (start < 0) continue;
    const header = page.slice(start).find((row) => row.cells.some((cell) => /^VALOR/.test(cell.text)));
    const valueX = header?.cells.find((cell) => /^VALOR/.test(cell.text))?.x;
    const vatX = header?.cells.find((cell) => /^IVA$/.test(cell.text))?.x;
    const periodX = header?.cells.find((cell) => /^PERÍODO/.test(cell.text))?.x;
    if (!header || valueX === undefined) break;

    let section = '';
    let group = '';
    let running = 0;
    let assigned = 0;
    const periods: { start: string; end: string }[] = [];
    for (const row of page.slice(page.indexOf(header) + 1)) {
      const [first] = row.cells;
      if (!first) continue;
      if (/^Total sem IVA$/.test(first.text)) {
        const net = milli(row.cells.at(-1)?.text);
        if (net !== null && net !== running) result.warnings.push('Detail lines do not add up');
        break;
      }
      const valueCell = row.cells.find((cell) => cell !== first && Math.abs(cell.x - valueX) < 25);
      const value = milli(valueCell?.text);
      if (value === null) {
        if (row.cells.length !== 1) continue;
        if (/^\d+$/.test(first.text.replace(/\s+/g, ''))) continue; // service number
        if (first.text === first.text.toUpperCase()) {
          section = first.text;
          group = '';
        } else {
          group = first.text;
        }
        continue;
      }
      running += value;
      const amountCents = cents(running) - assigned;
      assigned += amountCents;

      const line: ExtractedLine = {
        kind: /^Arredondamento$/i.test(first.text) ? 'other' : kindOf(section, group, value),
        description: first.text,
        amountCents,
      };
      const vatCell =
        vatX === undefined ? undefined : row.cells.find((cell) => Math.abs(cell.x - vatX) < 15);
      const vatRate = rate(vatCell?.text);
      if (vatRate !== undefined) line.vatRate = vatRate;
      result.lines.push(line);

      const periodCell =
        periodX === undefined ? undefined : row.cells.find((cell) => Math.abs(cell.x - periodX) < 15);
      const range = periodCell && rangeText(periodCell.text);
      const dates = range && reference ? dayMonthRange(range, reference) : null;
      if (dates && /^mensalidades$/i.test(section)) periods.push(dates);
    }
    if (periods.length > 0) {
      const starts = periods.map((period) => period.start).sort();
      const ends = periods.map((period) => period.end).sort();
      result.periodStart = { value: starts[0] ?? '', confidence: 'high' };
      result.periodEnd = { value: ends.at(-1) ?? '', confidence: 'high' };
    }
    return;
  }
  result.warnings.push('Billing detail not found');
}

/** "Período de fidelização a decorrer no serviço … até 14-02-2027." */
function parseLoyalty(pages: CellRow[][], result: ExtractedInvoice) {
  for (const page of pages) {
    const text = page.map((row) => row.text).join(' ');
    const match =
      /fidelização a decorrer no serviço [\d\s]+até\s*(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{4})/.exec(
        text,
      );
    const end = match && date(`${match[1]}-${match[2]}-${match[3]}`);
    if (end) {
      result.loyaltyEndDate = { value: end, confidence: 'high' };
      return;
    }
  }
}

/**
 * Services from the tariff and the detail lines. Only mobile tariffs have
 * been seen ("M Móvel Ilimitado"); anything else is a guess.
 */
function parseServices(result: ExtractedInvoice) {
  const texts = [result.tariffName?.value ?? '', ...result.lines.map((line) => line.description)];
  const found = new Set<TelecomService>();
  let guess = false;
  const unseen: [RegExp, TelecomService][] = [
    [/\b(fibra|internet)\b/i, 'internet'],
    [/\b(tv|televis[ãa]o)\b/i, 'tv'],
    [/\b(fixo|voz fixa)\b/i, 'landline'],
  ];
  for (const text of texts) {
    if (/m[óo]vel/i.test(text)) found.add('mobile');
    for (const [pattern, service] of unseen) {
      if (!pattern.test(text)) continue;
      found.add(service);
      guess = true;
    }
  }
  if (found.size > 0) {
    result.telecomServices = {
      value: TELECOM_SERVICES.filter((service) => found.has(service)),
      confidence: guess ? 'low' : 'high',
    };
  }
}

export const meoParser: Parser = {
  id: 'meo',
  name: 'MEO',
  version: '1.0.0',
  updated: '2026-10-16',
  sectors: ['telecom'],
  issuerNifs: [NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map((page) => page.items.map((item) => item.str).join(' ')).join(' ');
    return /\bmymeo\.pt\b/.test(text) && /DETALHE\s+DE\s+FATURAÇÃO/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'telecom';
    const pages = ctx.pages.map(cellRows);
    const [first] = pages;
    if (!first) {
      result.warnings.push('Empty document');
      return result;
    }
    parseHeader(first, result);
    parseTotals(first, result);
    parseDetail(pages, qr?.date ?? result.issueDate?.value, result);
    parseLoyalty(pages, result);
    parseServices(result);

    if (qr?.docId && result.docId && result.docId.value !== normalize(qr.docId)) {
      result.warnings.push('Document number differs from the QR code');
    }
    if (qr?.date && result.issueDate && result.issueDate.value !== qr.date) {
      result.warnings.push('Issue date differs from the QR code');
    }
    return result;
  },
};
