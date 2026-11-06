/**
 * Via Verde "Extrato/Recibo": one monthly statement that groups the invoices
 * of every issuer used that month (Brisa, Infraestruturas de Portugal, AEDL,
 * parking operators, Via Verde's own fee), each with its own fiscal QR code.
 * Each invoice has a block: "Nº de Fatura: <number>" with the issue date,
 * the issuer ("Brisa Concessão Rodoviária (BR)" … "MCRC … - NIPC <nif>"), and
 * "Total em Portagens/Estacionamentos/Euros" and "IVA incluído…" with the
 * amounts to the right. Two template versions seen (2025–26 and mid-2026),
 * with different spacing, so values are found by row and not by offset.
 *
 * All of them go to one contract with Via Verde (`contractHolder`), and the
 * amounts follow usage (`usageBased`). The trip detail ("Detalhe") has no
 * fiscal QR code and is not read.
 */
import type { PageText, TextItem } from '../pdf/text';
import type { FiscalQr } from '../qr/parse';
import { emptyExtraction, type ExtractedInvoice, type Parser, type ParserContext } from './types';
import { amount, findItem, normalize, valueRightOf } from './utils';

const ID = 'via-verde';
const NAME = 'Via Verde';
/** Via Verde Portugal: field A of its fee invoice in every statement (fixtures), NIPC in the footer. */
const VIA_VERDE_NIF = '504656767';

/** "Nº de Fatura: FT BR2026/014850221", "Nº de Fatura:* FT …", "Nº de Fatura/Recibo: FR …". */
const HEADER = /^N.{1,2} de Fatura(?:\/Recibo)?:\*?\s*(.+)$/;
const TITLE = /^PAGAMENTOS? DE SERVI.OS VIA VERDE$/;
const ISSUE_DATE = /Data de Emiss.o:\s*(\d{4}-\d{2}-\d{2})$/;
/** "Brisa Concessão Rodoviária (BR)": the issuer and its series code. */
const ISSUER = /^(.+?)\s*\([A-Z0-9]{2}\)$/;
const NIPC = /NIPC\s*(\d[\d ]{7,10}\d)$/;
const TOTAL = /^Total (?:pago )?em /;
const VAT = /^IVA inclu.do/;
const AMOUNT = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
/** Left column of a block (labels); the QR codes are drawn with a font on the right. */
const LABEL_MAX_X = 120;
const ROW_SLACK = 4;

interface Block {
  page: PageText;
  docId: string;
  items: TextItem[];
}

const compact = (text: string) => normalize(text).replace(/\s+/g, '');

/** From each "Nº de Fatura" header to the next one on the page. */
function blocks(pages: readonly PageText[]): Block[] {
  return pages.flatMap((page) => {
    const headers = page.items
      .filter((item) => HEADER.test(normalize(item.str)))
      .sort((a, b) => a.y - b.y);
    return headers.map((header, index) => {
      const top = header.y - ROW_SLACK;
      const bottom = (headers[index + 1]?.y ?? Infinity) - ROW_SLACK;
      return {
        page,
        docId: HEADER.exec(normalize(header.str))![1]!,
        items: page.items.filter((item) => item.y >= top && item.y < bottom),
      };
    });
  });
}

function find(block: Block, pattern: RegExp): TextItem | undefined {
  return block.items.find((item) => pattern.test(normalize(item.str)));
}

/** The amount on the same row as a label of the left column. */
function amountOf(block: Block, label: RegExp) {
  const item = block.items.find(
    (candidate) => candidate.x < LABEL_MAX_X && label.test(normalize(candidate.str)),
  );
  if (!item) return null;
  const value = block.items
    .filter(
      (candidate) =>
        candidate.x > item.x &&
        Math.abs(candidate.y - item.y) <= ROW_SLACK &&
        AMOUNT.test(normalize(candidate.str)),
    )
    .sort((a, b) => a.x - b.x)[0];
  return amount(value?.str);
}

function detect(ctx: ParserContext): boolean {
  return (
    ctx.pages.some((page) => findItem(page, TITLE) !== undefined) &&
    ctx.pages.some((page) => findItem(page, HEADER) !== undefined)
  );
}

function parse(ctx: ParserContext, qr?: FiscalQr): ExtractedInvoice {
  const result = emptyExtraction();
  result.sector = 'other';
  result.contractLabel = { value: NAME, confidence: 'high' };
  result.contractHolder = { value: { nif: VIA_VERDE_NIF, name: NAME }, confidence: 'high' };
  result.usageBased = true;

  const first = ctx.pages[0];
  const contractLabel = first ? findItem(first, /^N.{1,2} DE CONTRATO:$/) : undefined;
  const contract = first && contractLabel ? valueRightOf(first, contractLabel) : undefined;
  if (contract && /^\d+$/.test(normalize(contract.str))) {
    result.customerNumber = { value: normalize(contract.str), confidence: 'high' };
  }

  const all = blocks(ctx.pages);
  const block = qr?.docId
    ? all.find((candidate) => compact(candidate.docId) === compact(qr.docId!))
    : all[0];
  if (!block) {
    result.warnings.push('invoice block not found');
    return result;
  }

  result.docId = { value: normalize(block.docId), confidence: 'high' };
  const issued = find(block, ISSUE_DATE);
  if (issued) {
    result.issueDate = { value: ISSUE_DATE.exec(normalize(issued.str))![1]!, confidence: 'high' };
  }
  const issuer = find(block, ISSUER);
  if (issuer) {
    result.issuerName = { value: ISSUER.exec(normalize(issuer.str))![1]!, confidence: 'high' };
  } else {
    result.warnings.push('issuer name not found');
  }
  const nipc = find(block, NIPC);
  const nif = nipc ? NIPC.exec(normalize(nipc.str))![1]!.replace(/ /g, '') : undefined;
  if (qr && nif !== qr.issuerNif) result.warnings.push('issuer NIPC differs from the QR code');

  const total = amountOf(block, TOTAL);
  if (total !== null) result.totalCents = { value: total, confidence: 'high' };
  const vat = amountOf(block, VAT);
  if (vat !== null) result.vatCents = { value: vat, confidence: 'high' };
  if (total !== null && vat !== null) {
    result.netCents = { value: total - vat, confidence: 'high' };
  }
  return result;
}

export const viaVerdeParser: Parser = {
  id: ID,
  name: NAME,
  version: '1.0.0',
  updated: '2026-11-06',
  sectors: ['other'],
  issuerNifs: [VIA_VERDE_NIF],
  detect,
  parse,
};
