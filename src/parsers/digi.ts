/**
 * DIGI Portugal (telecom). One page, one QR code: header with the invoice
 * number, billing period, issue and due dates (label on the left, value at
 * x≈444); client data; "Serviço(s)" with one line per service and its value
 * with VAT ("Fibra 1 Gb (9 Ago - 8 Set) | 10,00 €"); then discounts, the totals
 * without VAT, VAT and with VAT, and the loyalty period. Layout studied on a
 * 2026 fibre-only invoice.
 */
import type { TelecomService } from '../domain/types';
import type { PageText } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import {
  emptyExtraction,
  type ExtractedInvoice,
  type ExtractedLine,
  type Parser,
  type ParserContext,
} from './types';
import { amount, date, dayMonthRange, findItem, normalize, rows, type Row } from './utils';

const ID = 'digi';
/** Field A of the QR code (fixture). */
const DIGI_NIF = '516222201';

/** "Fibra 1 Gb (9 Ago - 8 Set)". */
const SERVICE = /^(.+?) \((\d{1,2} \p{L}{3}) - (\d{1,2} \p{L}{3})\)$/u;

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

/** The value on the same row as a header label ("Data de emissão | 20/09/2026"). */
function valueOf(all: Row[], label: RegExp): string | undefined {
  const row = all.find((candidate) => label.test(normalize(candidate.items[0]?.str ?? '')));
  const value = row?.items.at(-1);
  return value && !label.test(normalize(value.str)) ? normalize(value.str) : undefined;
}

/** A total on the right of its label ("Valor desta fatura (s/ IVA) | 8,13 €"). */
function totalOf(all: Row[], label: RegExp): number | null {
  const row = all.find((candidate) => label.test(normalize(candidate.items[0]?.str ?? '')));
  return amount(row?.items.at(-1)?.str);
}

function servicesOf(descriptions: string[]): TelecomService[] {
  const found = new Set<TelecomService>();
  for (const description of descriptions) {
    if (/fibra|internet/i.test(description)) found.add('internet');
    if (/\bTV\b|televis/i.test(description)) found.add('tv');
    if (/fixo|telefone/i.test(description)) found.add('landline');
    if (/m[óo]vel|telem[óo]vel/i.test(description)) found.add('mobile');
  }
  return (['internet', 'tv', 'landline', 'mobile'] as const).filter((service) =>
    found.has(service),
  );
}

/** Rows between "Serviço(s)" and "Descontos associados": "<id> | <service (period)> | <value>". */
function parseServices(all: Row[], result: ExtractedInvoice, reference: string | undefined) {
  const start = all.findIndex((row) => /^Serviço\(s\)$/.test(normalize(row.items[0]?.str ?? '')));
  const end = all.findIndex((row) =>
    /^Descontos associados$/.test(normalize(row.items[0]?.str ?? '')),
  );
  if (start < 0 || end < start) {
    result.warnings.push('Services not found');
    return;
  }
  const names: string[] = [];
  for (const row of all.slice(start + 1, end)) {
    const value = amount(row.items.at(-1)?.str);
    if (value === null || row.items.length < 2) continue;
    const text = row.items
      .slice(0, -1)
      .map((item) => normalize(item.str))
      .find((part) => /\p{L}{3}/u.test(part) && !/^[A-Z]\d+$/.test(part));
    if (!text) continue;
    const match = SERVICE.exec(text);
    const description = match?.[1] ?? text;
    names.push(description);
    result.lines.push({ kind: 'base_fee', description, amountCents: value });
    if (match && reference && !result.periodStart) {
      const range = dayMonthRange(`${match[2]} - ${match[3]}`, reference);
      if (range) {
        result.periodStart = { value: range.start, confidence: 'high' };
        result.periodEnd = { value: range.end, confidence: 'high' };
      }
    }
  }
  const discount = totalOf(all, /^Descontos associados$/);
  if (discount) {
    const line: ExtractedLine = {
      kind: 'discount',
      description: 'Descontos associados',
      amountCents: -Math.abs(discount),
    };
    result.lines.push(line);
  }
  if (names.length > 0) {
    result.tariffName = { value: names.join(' + '), confidence: 'high' };
    const services = servicesOf(names);
    if (services.length > 0) result.telecomServices = { value: services, confidence: 'high' };
  }
}

/** "Período de fidelização" box: "Sem periodo de fidelização a decorrer." or a date. */
function parseLoyalty(page: PageText, result: ExtractedInvoice) {
  const label = findItem(page, /^Período de fidelização$/);
  if (!label) return;
  const below = page.items.filter(
    (item) => item.y > label.y && item.y - label.y < 40 && Math.abs(item.x - label.x) < 20,
  );
  for (const item of below) {
    const found = /(\d{2}[/-]\d{2}[/-]\d{4})/.exec(normalize(item.str))?.[1];
    const end = date(found);
    if (end) {
      // Never seen on a real invoice yet.
      result.loyaltyEndDate = { value: end, confidence: 'low' };
      return;
    }
  }
}

export const digiParser: Parser = {
  id: ID,
  name: 'DIGI',
  version: '1.0.0',
  updated: '2026-10-17',
  sectors: ['telecom'],
  issuerNifs: [DIGI_NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /DIGI Portugal, Lda/.test(text) && /Serviço\(s\)/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'telecom';
    result.linesIncludeVat = true;
    const page = ctx.pages.find((candidate) => findItem(candidate, /^Serviço\(s\)$/));
    if (!page) {
      result.warnings.push('Invoice not found');
      return result;
    }
    const all = rows(page);

    const printed = valueOf(all, /^Fatura n\.º$/)?.replace(/^Fatura /, '');
    if (printed) result.docId = { value: printed, confidence: 'high' };
    if (qr?.docId && printed && normalize(qr.docId) !== printed) {
      result.warnings.push('Document number differs from the QR code');
    }
    const issue = date(valueOf(all, /^Data de emissão$/));
    if (issue) result.issueDate = { value: issue, confidence: 'high' };
    const due = date(valueOf(all, /^Data limite de pagamento:?$/));
    if (due) result.dueDate = { value: due, confidence: 'high' };
    const period = /^(\S+) a (\S+)$/.exec(
      valueOf(all, /^Periodo de faturação$|^Período de faturação$/) ?? '',
    );
    const start = date(period?.[1]);
    const end = date(period?.[2]);
    if (start && end) {
      result.periodStart = { value: start, confidence: 'high' };
      result.periodEnd = { value: end, confidence: 'high' };
    }
    const customer = all
      .find((row) => /^Nº cliente$/.test(normalize(row.items[0]?.str ?? '')))
      ?.items.find((item, index) => index > 0 && /^\d+$/.test(normalize(item.str)));
    if (customer) result.customerNumber = { value: normalize(customer.str), confidence: 'high' };

    parseServices(all, result, issue ?? undefined);

    const net = totalOf(all, /^Valor desta fatura \(s\/ IVA\)$/);
    const vat = totalOf(all, /^IVA \(/);
    const total = totalOf(all, /^Valor desta fatura \(c\/ IVA\)$/);
    if (net !== null) result.netCents = { value: net, confidence: 'high' };
    if (vat !== null) result.vatCents = { value: vat, confidence: 'high' };
    if (total !== null) result.totalCents = { value: total, confidence: 'high' };
    const rate = /^IVA \((\d+)(?:\.\d+)?%\)$/.exec(
      normalize(
        all.find((row) => /^IVA \(/.test(normalize(row.items[0]?.str ?? '')))?.items[0]?.str ?? '',
      ),
    )?.[1];
    if (rate) for (const line of result.lines) line.vatRate = Number(rate);

    parseLoyalty(page, result);
    return result;
  },
};
