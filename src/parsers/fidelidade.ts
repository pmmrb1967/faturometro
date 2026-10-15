/**
 * Fidelidade (Companhia de Seguros): "Fatura/Recibo" of a policy's premium
 * (health insurance billed monthly, …), one QR code. Exempt from VAT; the
 * stamp duty is QR field M. Some accented letters come out of this PDF as
 * U+FFFD ("PR�MIO", "Ap�lice"), so labels match any character there. Layout
 * studied on 2026 health insurance receipts.
 */
import type { InvoiceLine } from '../domain/types';
import type { PageText, TextItem } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import {
  emptyExtraction,
  type ExtractedInvoice,
  type ExtractedLine,
  type Parser,
  type ParserContext,
} from './types';
import { amount, findItem, normalize } from './utils';

const ID = 'fidelidade';
/** Field A of the QR code on Fidelidade receipts (fixtures). */
const NIF = '500918880';

/** Charges printed next to the premium: label → description and kind. */
const CHARGES: [RegExp, string, InvoiceLine['kind']][] = [
  [/^SELO$/, 'Imposto do selo', 'tax'],
  [/^INEM$/, 'INEM', 'tax'],
  [/^FGA$/, 'FGA', 'tax'],
  [/^ANPC$/, 'ANPC', 'tax'],
];

/** Words this PDF prints with a broken accent, for what is shown to the user. */
const REPAIRS: [RegExp, string][] = [
  [/SA�DE/g, 'SAÚDE'],
  [/PR�MIO/g, 'PRÉMIO'],
  [/AP�LICE/g, 'APÓLICE'],
  [/�/g, ''],
];

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function textOf(page: PageText): string {
  return page.items.map((item) => item.str).join(' ');
}

function repaired(text: string): string {
  return REPAIRS.reduce((value, [pattern, word]) => value.replace(pattern, word), text);
}

/** "SAÚDE MULTICARE INDIVIDUAL" → "Saúde multicare individual". */
function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('pt-PT');
  return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
}

/** The first amount below `label`, within `dx` points horizontally and 30 points down. */
function amountBelow(page: PageText, label: TextItem, dx: number): number | null {
  const below = page.items
    .filter(
      (item) =>
        item.y > label.y + 1 &&
        item.y - label.y <= 30 &&
        Math.abs(item.x - label.x) <= dx &&
        amount(item.str) !== null,
    )
    .sort((a, b) => a.y - b.y)[0];
  return amount(below?.str);
}

/** "Lisboa, 03 de setembro de 2026" → "2026-09-03". */
function letterDate(page: PageText): string | undefined {
  for (const item of page.items) {
    const match = /(\d{1,2}) de (\S+) de (\d{4})$/.exec(normalize(item.str));
    const month = match ? MONTHS.indexOf((match[2] ?? '').slice(0, 3).toLowerCase()) + 1 : 0;
    if (match && month > 0) {
      return `${match[3]}-${String(month).padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`;
    }
  }
  return undefined;
}

function parseAmounts(page: PageText, result: ExtractedInvoice, qr?: FiscalQr) {
  result.vatCents = { value: 0, confidence: 'high' };
  const premium = findItem(page, /^PR.MIO COMERCIAL:$/);
  const premiumCents = premium ? amountBelow(page, premium, 60) : null;
  if (premiumCents !== null) {
    result.lines.push({
      kind: 'base_fee',
      description: 'Prémio comercial',
      amountCents: premiumCents,
    });
  } else {
    result.warnings.push('Commercial premium not found');
  }
  for (const [pattern, description, kind] of CHARGES) {
    const label = findItem(page, pattern);
    if (!label) continue;
    const value = page.items.find(
      (item) => Math.abs(item.y - label.y) <= 2.5 && item.x > label.x && amount(item.str) !== null,
    );
    const cents = amount(value?.str);
    if (cents === null || cents === 0) continue;
    const line: ExtractedLine = { kind, description, amountCents: cents };
    result.lines.push(line);
    if (pattern.test('SELO') && qr && (qr.stampDutyCents ?? 0) !== cents) {
      result.warnings.push(`Stamp duty ${cents} ≠ QR field M ${qr.stampDutyCents ?? 0}`);
    }
  }
  result.linesIncludeVat = true;
  const total = findItem(page, /^TOTAL$/);
  const totalCents = total ? amountBelow(page, total, 20) : null;
  if (totalCents !== null) result.totalCents = { value: totalCents, confidence: 'high' };
}

export const fidelidadeParser: Parser = {
  id: ID,
  name: 'Fidelidade',
  version: '1.0.0',
  updated: '2026-10-15',
  sectors: ['insurance'],
  issuerNifs: [NIF],

  detect(ctx: ParserContext) {
    const text = ctx.pages.map(textOf).join(' ');
    return /Fidelidade - Companhia de Seguros/.test(text) && /FATURA\/RECIBO/.test(text);
  },

  parse(ctx: ParserContext, qr?: FiscalQr) {
    const result = emptyExtraction();
    result.sector = 'insurance';
    const page = ctx.pages.find((candidate) => findItem(candidate, /^FATURA\/RECIBO /));
    if (!page) {
      result.warnings.push('Receipt not found');
      return result;
    }
    const all = textOf(page);

    const docId = /^FATURA\/RECIBO N\S* (.+)$/.exec(
      normalize(findItem(page, /^FATURA\/RECIBO /)?.str ?? ''),
    )?.[1];
    if (docId) result.docId = { value: docId, confidence: 'high' };
    const issue = letterDate(page);
    if (issue) result.issueDate = { value: issue, confidence: 'high' };
    const period = /Per\S*odo do Recibo: (\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})/.exec(all);
    if (period?.[1] && period[2]) {
      result.periodStart = { value: period[1], confidence: 'high' };
      result.periodEnd = { value: period[2], confidence: 'high' };
    }
    const customer = /N\S* Cliente: (\S+)/.exec(all)?.[1];
    if (customer) result.customerNumber = { value: customer, confidence: 'high' };

    parseAmounts(page, result, qr);

    const policyNumber = /Ap\S*lice: (\S+)/.exec(all)?.[1];
    const productLabel = findItem(page, /^Ramo\/Produto:$/);
    const productItem = productLabel
      ? page.items
          .filter(
            (item) =>
              item.y > productLabel.y + 1 &&
              item.y - productLabel.y <= 30 &&
              Math.abs(item.x - productLabel.x) <= 6,
          )
          .sort((a, b) => a.y - b.y)[0]
      : undefined;
    const product = productItem ? repaired(normalize(productItem.str)) : undefined;
    result.insurance = {
      value: {
        ...(product ? { product } : {}),
        ...(policyNumber ? { policyNumber } : {}),
      },
      confidence: 'high',
    };
    if (product)
      result.contractLabel = { value: `Seguro ${sentenceCase(product)}`, confidence: 'high' };
    return result;
  },
};
