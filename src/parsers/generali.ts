/**
 * Generali Seguros: "Fatura/Recibo" of a policy's premium (car, home, …), or
 * the "Aviso" sent before it (same layout, a letter saying when the direct
 * debit is taken and the payment deadline), one QR code. Page 1: client and contract data (product, option, policy number,
 * insured object) and the premium breakdown (commercial premium, costs, stamp
 * duty, other charges and fees); page 2: insured objects and capitals. Exempt
 * from VAT; the stamp duty is QR field M. Layout studied on 2025–2026 receipts.
 */
import type { InsuranceDetails, InvoiceLine } from '../domain/types';
import type { PageText, TextItem } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import {
  emptyExtraction,
  type ExtractedInvoice,
  type ExtractedLine,
  type Parser,
  type ParserContext,
} from './types';
import { directDebitInText } from './direct-debit';
import { amount, date, findItem, normalize, rows, valueRightOf } from './utils';

const ID = 'generali';
/** Field A of the QR code on Generali receipts (fixtures). */
export const NIF = '500940231';

/** Premium breakdown rows: label → line kind (rows that are totals are left out). */
const BREAKDOWN: [RegExp, InvoiceLine['kind']][] = [
  [/^Prémio comercial$/, 'base_fee'],
  [/^Custos de fracionamento$/, 'other'],
  [/^Custos de gestão do seguro$/, 'other'],
  [/^Imposto de selo$/, 'tax'],
  [/^Outros encargos e taxas$/, 'tax'],
];
const STAMP_DUTY = /^Imposto de selo$/;

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

function label(page: PageText, pattern: RegExp): string | undefined {
  const item = findItem(page, pattern);
  const value = item ? valueRightOf(page, item) : undefined;
  return value ? normalize(value.str) : undefined;
}

/** "AUTOMÓVEL" → "Automóvel", "RESPONSABILIDADE CIVIL" → "Responsabilidade civil". */
function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('pt-PT');
  return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
}

/** Amount of the breakdown row whose label is `item` (the last euro amount on its row). */
function breakdownAmount(page: PageText, item: TextItem): number | null {
  const row = rows(page).find((candidate) => candidate.items.includes(item));
  const value = [...(row?.items ?? [])]
    .reverse()
    .find((candidate) => candidate.x > item.x && amount(candidate.str) !== null);
  return amount(value?.str);
}

function parseBreakdown(page: PageText, result: ExtractedInvoice, qr?: FiscalQr) {
  // "Isento de IVA (N.º 28 do Art.º 9º CIVA)".
  result.vatCents = { value: 0, confidence: 'high' };
  for (const [pattern, kind] of BREAKDOWN) {
    const item = findItem(page, pattern);
    const value = item ? breakdownAmount(page, item) : null;
    if (!item || value === null) continue;
    if (STAMP_DUTY.test(normalize(item.str)) && qr && (qr.stampDutyCents ?? 0) !== value) {
      result.warnings.push(`Stamp duty ${value} ≠ QR field M ${qr.stampDutyCents ?? 0}`);
    }
    if (value === 0) continue;
    const line: ExtractedLine = { kind, description: normalize(item.str), amountCents: value };
    result.lines.push(line);
  }
  result.linesIncludeVat = true;
  // "Total:" on receipts, "Valor total a pagar:" on notices.
  const total = findItem(page, /^(?:Valor total a pagar|Total):$/);
  const totalValue = total ? breakdownAmount(page, total) : null;
  if (totalValue !== null) result.totalCents = { value: totalValue, confidence: 'high' };
}

/**
 * Page 2 "Dados do Objeto Seguro": a home policy lists objects (RECHEIO,
 * IMÓVEL) with their insured value; a car policy has one row with columns
 * whose headers are stacked over two rows (CAPITAL / RESPONSABILIDADE CIVIL).
 */
function parseCapitals(page: PageText): { name: string; capitalCents: number }[] {
  const all = rows(page);
  const start = all.findIndex((row) => /^Dados do Objeto Seguro$/.test(row.text));
  const end = all.findIndex(
    (row, index) => index > start && /^INFORMAÇÕES IMPORTANTES$/.test(row.text),
  );
  if (start < 0) return [];
  const table = all.slice(start + 1, end < 0 ? undefined : end);
  const header = table.filter((row) => row.items.every((item) => amount(item.str) === null));
  const data = table.filter((row) => row.items.some((item) => /€/.test(item.str)));
  const homeStyle = header.some((row) => /OBJETO SEGURO/.test(row.text));
  const capitals: { name: string; capitalCents: number }[] = [];
  for (const row of data) {
    const values = row.items.filter((item) => /€/.test(item.str) && amount(item.str) !== null);
    for (const value of values) {
      const cents = amount(value.str);
      if (cents === null) continue;
      let name: string;
      if (homeStyle) {
        name = normalize(row.items[0]?.str ?? '');
      } else {
        // Header words in the value's column, top to bottom, without "CAPITAL".
        name = header
          .flatMap((headerRow) => headerRow.items)
          .filter((item) => Math.abs(item.x - value.x) <= 45 && !/€/.test(item.str))
          .sort((a, b) => a.y - b.y)
          .map((item) => normalize(item.str))
          .join(' ')
          .replace(/^CAPITAL\s+/, '');
      }
      if (name) capitals.push({ name: sentenceCase(name), capitalCents: cents });
    }
  }
  return capitals;
}

function parseInsurance(page: PageText, detail?: PageText): InsuranceDetails {
  const details: InsuranceDetails = {};
  const product = label(page, /^Produto:$/);
  if (product) details.product = product;
  const option = label(page, /^Opção:$/);
  if (option) details.option = option;
  const policy = label(page, /^N\.º Apólice:$/);
  if (policy) details.policyNumber = policy;
  const capitals = detail ? parseCapitals(detail) : [];
  if (capitals.length > 0) details.capitals = capitals;

  const make = label(page, /^Marca:$/);
  const model = label(page, /^Modelo:$/);
  if (make || model) {
    details.insuredObject = [make, model].filter(Boolean).join(' ');
  } else if (capitals.length > 0 && /OBJETO SEGURO/.test(detail ? textOf(detail) : '')) {
    details.insuredObject = capitals.map((capital) => capital.name).join(', ');
  }
  return details;
}

export const generaliParser: Parser = {
  id: ID,
  name: 'Generali Seguros',
  version: '1.1.0',
  updated: '2026-10-22',
  sectors: ['insurance'],
  issuerNifs: [NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /Generali Seguros/.test(text) && /Detalhe do Valor a Pagar/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'insurance';
    const page = ctx.pages.find((candidate) => findItem(candidate, /^Detalhe do Valor a Pagar$/));
    if (!page) {
      result.warnings.push('Premium breakdown not found');
      return result;
    }
    const detail = ctx.pages.find(
      (candidate) => candidate !== page && findItem(candidate, /^Dados do Objeto Seguro$/),
    );

    const docId = label(page, /^N\.º (?:Fatura\/Recibo|Aviso):$/);
    if (docId) result.docId = { value: docId, confidence: 'high' };
    if (qr?.docId && docId && normalize(qr.docId) !== docId) {
      result.warnings.push('Document number differs from the QR code');
    }
    const issue = date(label(page, /^Data de emissão:$/));
    if (issue) result.issueDate = { value: issue, confidence: 'high' };
    const period = /^(\d{4}-\d{2}-\d{2})(?: \d{2}:\d{2})? a (\d{4}-\d{2}-\d{2})$/.exec(
      label(page, /^Período:$/) ?? '',
    );
    if (period?.[1] && period[2]) {
      result.periodStart = { value: period[1], confidence: 'high' };
      result.periodEnd = { value: period[2], confidence: 'high' };
    }
    // Notices: the deadline, and the day the direct debit is taken (if paid that way).
    const due = date(label(page, /^Limite de pagamento:$/));
    if (due) result.dueDate = { value: due, confidence: 'high' };
    const debit = directDebitInText(ctx.pages);
    if (debit) result.directDebitDate = { value: debit, confidence: 'high' };
    const customer = label(page, /^N\.º Cliente:$/);
    if (customer) result.customerNumber = { value: customer, confidence: 'high' };

    // "Seguro Automóvel", "Seguro Multirrisco": the contract's name.
    const title = page.items.find((item) => /^Seguro \S/.test(normalize(item.str)));
    if (title) result.contractLabel = { value: normalize(title.str), confidence: 'high' };

    parseBreakdown(page, result, qr);
    result.insurance = { value: parseInsurance(page, detail), confidence: 'high' };
    return result;
  },
};
