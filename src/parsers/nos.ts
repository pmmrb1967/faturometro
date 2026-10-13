/**
 * NOS (telecommunications). Page 1: header (customer, invoice number, date),
 * summary by service with VAT included, due date. Following pages: detail
 * per service. Layout studied on 2026 invoices.
 */
import type { InvoiceLine } from '../domain/types';
import { sumCents } from '../lib/money';
import type { PageText } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import { emptyExtraction, type ExtractedInvoice, type Parser, type ParserContext } from './types';
import { amount, date, dayMonthRange, findItem, normalize, rows, valueBelow } from './utils';

/** Field A of the QR code on NOS invoices (fixtures). */
const NIF = '502604751';

const KINDS: [RegExp, InvoiceLine['kind']][] = [
  [/^pacotes?$/i, 'base_fee'],
  [/^equipamentos?$/i, 'equipment'],
  [/^telem[óo]vel$/i, 'usage'],
  [/^(televis[ãa]o|internet|telefone|voz)$/i, 'addon'],
];

function kindOf(service: string): InvoiceLine['kind'] {
  return KINDS.find(([pattern]) => pattern.test(service))?.[1] ?? 'other';
}

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

function parseHeader(page: PageText, result: ExtractedInvoice) {
  const customer = findItem(page, /^N\.º cliente$/);
  const customerValue = customer && valueBelow(page, customer);
  if (customerValue)
    result.customerNumber = { value: normalize(customerValue.str), confidence: 'high' };

  const docId = findItem(page, /^Fatura n\.º$/);
  const docValue = docId && valueBelow(page, docId);
  if (docValue) result.docId = { value: normalize(docValue.str), confidence: 'high' };

  const issue = findItem(page, /^Data da fatura$/);
  const issueValue = date(issue && valueBelow(page, issue)?.str);
  if (issueValue) result.issueDate = { value: issueValue, confidence: 'high' };

  const due = findItem(page, /^Total a pagar até /);
  const dueValue = date(due?.str.replace(/^Total a pagar até /, ''));
  if (dueValue) result.dueDate = { value: dueValue, confidence: 'high' };
}

/** "Nesta fatura" table: service | qty | VAT | service c/ IVA | discount c/ IVA | total c/ IVA. */
function parseSummary(page: PageText, result: ExtractedInvoice) {
  const header = findItem(page, /^Desconto$/);
  const totalRow = rows(page).find((row) => /^Valor desta fatura com IVA/.test(row.text));
  if (!header || !totalRow) {
    result.warnings.push('Summary table not found');
    return;
  }
  const vat: number[] = [];
  for (const row of rows(page)) {
    if (row.y <= header.y + 1 || row.y >= totalRow.y) continue;
    const label = normalize(row.items[0]?.str ?? '');
    // Only euro amounts: the quantity column ("1") would otherwise read as an amount.
    const amounts = row.items
      .filter((item) => item.str.includes('€'))
      .map((item) => amount(item.str))
      .filter((value) => value !== null);

    const vatMatch = /^IVA \((\d+)%\)$/.exec(label);
    if (vatMatch && amounts[0] !== undefined) {
      vat.push(amounts[0]);
      continue;
    }
    // Service rows have three amounts: service, discount, total (all with VAT).
    if (amounts.length !== 3) continue;
    const [service = 0, discount = 0, total = 0] = amounts;
    if (service - discount !== total) {
      result.warnings.push(`${label}: ${service} - ${discount} ≠ ${total}`);
    }
    const rate = row.items.map((item) => /^(\d+)%$/.exec(item.str.trim())?.[1]).find(Boolean);
    const vatRate = rate ? Number(rate) : undefined;
    const kind = kindOf(label);
    result.lines.push({
      kind,
      description: label,
      amountCents: service,
      ...(vatRate ? { vatRate } : {}),
    });
    if (discount !== 0) {
      result.lines.push({
        kind: 'discount',
        description: `Desconto ${label}`,
        amountCents: -discount,
        ...(vatRate ? { vatRate } : {}),
      });
    }
  }
  result.linesIncludeVat = true;

  const total = amount(totalRow.items.find((item) => amount(item.str) !== null)?.str);
  if (total !== null) result.totalCents = { value: total, confidence: 'high' };
  if (vat.length > 0) {
    result.vatCents = { value: sumCents(vat), confidence: 'high' };
    if (total !== null) result.netCents = { value: total - sumCents(vat), confidence: 'high' };
  }
  if (total !== null && sumCents(result.lines.map((line) => line.amountCents)) !== total) {
    result.warnings.push('Summary lines do not add up to the total');
  }
}

/** Detail pages: package name and the period it covers (billed in advance). */
function parseDetail(pages: PageText[], result: ExtractedInvoice) {
  const reference = result.issueDate?.value;
  for (const page of pages) {
    const packages = findItem(page, /^Informação sobre o seu pacote$/);
    if (!packages) continue;
    const first = rows(page).find(
      (row) =>
        row.y > packages.y + 1 &&
        row.items.some((item) => /^€-?\d+,\d{3}$/.test(item.str.trim())) &&
        row.items.some((item) => /^\d{1,2} [a-zç]{3} - \d{1,2} [a-zç]{3}$/i.test(item.str.trim())),
    );
    if (!first) continue;
    const name = first.items[0];
    if (name) result.tariffName = { value: normalize(name.str), confidence: 'high' };
    const rangeItem = first.items.find((item) => /\d [a-zç]{3} - \d/i.test(item.str));
    const range = rangeItem && reference ? dayMonthRange(rangeItem.str, reference) : null;
    if (range) {
      result.periodStart = { value: range.start, confidence: 'high' };
      result.periodEnd = { value: range.end, confidence: 'high' };
    }
    break;
  }

  // Loyalty: a date under "Data fim" (only "Não aplicável" seen so far: low confidence).
  for (const page of pages) {
    const label = findItem(page, /^Data fim$/);
    if (!label) continue;
    const value = page.items.find(
      (item) =>
        item.y > label.y &&
        item.y - label.y < 40 &&
        Math.abs(item.x - label.x) < 10 &&
        date(item.str),
    );
    const end = date(value?.str);
    if (end) result.loyaltyEndDate = { value: end, confidence: 'low' };
  }
}

export const nosParser: Parser = {
  id: 'nos',
  version: '1.0.0',
  sectors: ['telecom'],
  issuerNifs: [NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /NOS Comunicações, S\.A\./.test(text) && /Esta é a sua fatura NOS/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'telecom';
    const first = ctx.pages[0];
    if (!first) {
      result.warnings.push('Empty document');
      return result;
    }
    parseHeader(first, result);
    parseSummary(first, result);
    parseDetail(ctx.pages.slice(1), result);
    if (qr?.docId && result.docId && result.docId.value !== normalize(qr.docId)) {
      result.warnings.push('Document number differs from the QR code');
    }
    return result;
  },
};
