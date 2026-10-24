/**
 * Insurance documents that are not invoices (no fiscal QR code): they update
 * the policy's contract instead of creating an invoice.
 *
 * - Renewal letter ("Carta Ata"): renewal date, this year's and next year's
 *   premium, what changed it, and the capitals now and next year.
 * - Particular conditions ("Condições Particulares da Apólice"): product,
 *   coverages with capital and deductible, annual premium, bonus/malus.
 * - Signed proposal (Fidelidade "Proposta de Seguro"): read as particular
 *   conditions (`source: 'proposal'`).
 *
 * Layouts studied on Generali Seguros documents (2025–2026).
 */
import type { InsuranceCoverage, InsuranceDetails, InsuranceRenewal } from '../domain/types';
import type { PageText } from '../pdf/text';
import { readFidelidadeConditions } from './fidelidade-documents';
import { readFidelidadeProposal } from './fidelidade-proposal';
import { amount, date, findItem, normalize, quantity, rows, valueRightOf, type Row } from './utils';

export type PolicyDocument =
  | {
      kind: 'renewal';
      issuerName: string;
      /** "Seguro Casa". */
      title?: string;
      policyNumber?: string;
      renewal: InsuranceRenewal;
    }
  | {
      kind: 'conditions';
      /** Read from the proposal the client signed, not the policy's conditions. */
      source?: 'proposal';
      issuerName: string;
      title?: string;
      policyNumber?: string;
      details: InsuranceDetails;
    };

const ISSUER = /Generali Seguros/;

function label(pages: readonly PageText[], pattern: RegExp): string | undefined {
  for (const page of pages) {
    const item = findItem(page, pattern);
    const value = item ? valueRightOf(page, item) : undefined;
    if (value) return normalize(value.str);
  }
  return undefined;
}

function text(pages: readonly PageText[]): string {
  return pages.map((page) => page.items.map((item) => item.str).join(' ')).join(' ');
}

function title(pages: readonly PageText[]): string | undefined {
  const item = pages[0]?.items.find((candidate) => /^Seguro \S/.test(normalize(candidate.str)));
  return item ? normalize(item.str) : undefined;
}

function percent(value: string): number | null {
  return quantity(value.replace(/%$/, '').trim());
}

/** "Valor da anuidade atual 397,89 €; valor da próxima anuidade 432,51 €; variação de 8,7%". */
const ANNUITY =
  /Valor da anuidade atual ([\d .]+,\d{2}) €; valor da próxima anuidade ([\d .]+,\d{2}) €/;
/** "Valor do Recheio -» anuidade atual: 30 000,00 €; próxima anuidade: 30 000,00 €". */
const CAPITAL = /^(.+?) -» anuidade atual: ([\d .]+,\d{2}) €; próxima anuidade: ([\d .]+,\d{2}) €$/;

function readRenewal(pages: readonly PageText[]): PolicyDocument | null {
  const all = pages.flatMap((page) => rows(page));
  const annuity = all.map((row) => ANNUITY.exec(row.text.replace(/ \| /g, ' '))).find(Boolean);
  const renewalDate = date(label(pages, /^Data da renovação:$/));
  const current = amount(annuity?.[1]);
  const next = amount(annuity?.[2]);
  if (!renewalDate || current === null || next === null) return null;
  const renewal: InsuranceRenewal = { date: renewalDate, currentCents: current, nextCents: next };

  // Factors: the text after "…que a seguir detalhamos:" up to the footnotes ("(1) Fonte…").
  // Footnote marks sit on rows of their own and are dropped.
  const start = all.findIndex((row) => /a seguir detalhamos/.test(row.text));
  const isMark = (value: string) => /^\(\d\)$/.test(value.trim());
  const factorRows: Row[] = [];
  for (const row of all.slice(start + 1)) {
    const marks = row.items.filter((item) => isMark(item.str));
    if (marks.length > 0 && isMark(row.items[0]?.str ?? '') && marks.length < row.items.length)
      break;
    factorRows.push(row);
  }
  const factorText = factorRows
    .flatMap((row) => row.items.map((item) => item.str))
    .filter((value) => !isMark(value))
    .join(' ')
    .replace(/\s+/g, ' ');
  const factors = factorText
    .split(';')
    .map((part) => /^\s*(.+?)\s+(-?\d+,\d+)%\s*$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: (match[1] ?? '').trim(), pct: percent(match[2] ?? '') ?? 0 }));
  if (start >= 0 && factors.length > 0) renewal.factors = factors;

  const capitals = all
    .map((row) => CAPITAL.exec(normalize(row.text.replace(/ \| /g, ' '))))
    .filter((match): match is RegExpExecArray => match !== null)
    .flatMap((match) => {
      const currentCents = amount(match[2]);
      const nextCents = amount(match[3]);
      return currentCents !== null && nextCents !== null
        ? [{ name: (match[1] ?? '').trim(), currentCents, nextCents }]
        : [];
    });
  if (capitals.length > 0) renewal.capitals = capitals;

  const policyNumber = label(pages, /^N\.º Apólice:$/);
  const name = title(pages);
  return {
    kind: 'renewal',
    issuerName: 'Generali Seguros',
    ...(name ? { title: name } : {}),
    ...(policyNumber ? { policyNumber } : {}),
    renewal,
  };
}

/** Columns of the coverage table: name (left), capital (middle), deductible (right). */
const CAPITAL_X = 340;
const DEDUCTIBLE_X = 460;
/** A value printed above or below a coverage's name belongs to it within this distance. */
const NEAR = 6;

function columns(row: Row) {
  const join = (min: number, max: number) =>
    row.items
      .filter((item) => item.x >= min && item.x < max)
      .map((item) => normalize(item.str))
      .join(' ')
      .trim();
  return {
    left: join(0, CAPITAL_X),
    middle: join(CAPITAL_X, DEDUCTIBLE_X),
    right: join(DEDUCTIBLE_X, Infinity),
  };
}

interface Entry {
  name: string;
  ys: number[];
  capital: { y: number; text: string }[];
  deductible: { y: number; text: string }[];
}

/**
 * The "COBERTURAS | CAPITAL SEGURO | FRANQUIA" table. Names can wrap onto the
 * next rows (continuations start in lower case or with "("); values are on
 * the name's row or, when they take two lines ("Conforme Cond. Gerais e/ou" /
 * "Especiais"), on rows just above and below it. Rows with a name and no
 * value are group headings ("Responsabilidade civil").
 */
function readCoverages(pages: readonly PageText[]): InsuranceCoverage[] {
  for (const page of pages) {
    const all = rows(page);
    const header = all.findIndex((row) => /COBERTURAS/.test(row.text) && /FRANQUIA/.test(row.text));
    if (header < 0) continue;
    const table: Row[] = [];
    let previousY = all[header]!.y;
    for (const row of all.slice(header + 1)) {
      if (row.y - previousY > 15) break;
      table.push(row);
      previousY = row.y;
    }

    const entries: Entry[] = [];
    const valueRows: { y: number; middle: string; right: string }[] = [];
    for (const row of table) {
      const { left, middle, right } = columns(row);
      if (!left) {
        if (middle || right) valueRows.push({ y: row.y, middle, right });
        continue;
      }
      const last = entries.at(-1);
      let entry: Entry;
      if (last && /^[(a-zà-ú]/.test(left)) {
        last.name = `${last.name} ${left}`;
        last.ys.push(row.y);
        entry = last;
      } else {
        entry = { name: left, ys: [row.y], capital: [], deductible: [] };
        entries.push(entry);
      }
      if (middle) entry.capital.push({ y: row.y, text: middle });
      if (right) entry.deductible.push({ y: row.y, text: right });
    }
    for (const value of valueRows) {
      const distance = (entry: Entry) => Math.min(...entry.ys.map((y) => Math.abs(y - value.y)));
      const nearest = [...entries].sort((a, b) => distance(a) - distance(b))[0];
      if (!nearest || distance(nearest) > NEAR) continue;
      if (value.middle) nearest.capital.push({ y: value.y, text: value.middle });
      if (value.right) nearest.deductible.push({ y: value.y, text: value.right });
    }

    const joined = (parts: { y: number; text: string }[]) =>
      parts
        .sort((a, b) => a.y - b.y)
        .map((part) => part.text)
        .join(' ');
    return entries
      .filter((entry) => entry.capital.length > 0 || entry.deductible.length > 0)
      .map((entry) => {
        const coverage: InsuranceCoverage = { name: entry.name };
        const capital = joined(entry.capital);
        if (capital) coverage.capital = capital;
        const cents = amount(capital);
        if (cents !== null) coverage.capitalCents = cents;
        const deductible = joined(entry.deductible);
        if (deductible) coverage.deductible = deductible;
        return coverage;
      });
  }
  return [];
}

function readConditions(pages: readonly PageText[]): PolicyDocument | null {
  const coverages = readCoverages(pages);
  if (coverages.length === 0) return null;
  const details: InsuranceDetails = { coverages };
  const product = label(pages, /^Produto:$/);
  if (product) details.product = product;
  const option = label(pages, /^Opção:$/);
  if (option) details.option = option;
  const policyNumber = label(pages, /^N\.º Apólice:$/);
  if (policyNumber) details.policyNumber = policyNumber;
  const make = label(pages, /^Marca:$/);
  const model = label(pages, /^Modelo:$/);
  if (make || model) details.insuredObject = [make, model].filter(Boolean).join(' ');
  const premium = amount(label(pages, /^Prémio do Contrato \(valor anual\)$/));
  if (premium !== null) details.annualPremiumCents = premium;
  const start = date(label(pages, /^Data efeito:$/)?.slice(0, 10));
  if (start) details.startDate = start;
  const bonus = percent(label(pages, /^Índice de bonus\/malus:$/) ?? '');
  if (bonus !== null) details.bonusMalusPct = bonus;
  const name = title(pages);
  return {
    kind: 'conditions',
    issuerName: 'Generali Seguros',
    ...(name ? { title: name } : {}),
    ...(policyNumber ? { policyNumber } : {}),
    details,
  };
}

/** A renewal letter or particular conditions of a known insurer; null otherwise. */
export function readPolicyDocument(pages: readonly PageText[]): PolicyDocument | null {
  const all = text(pages);
  if (/Fidelidade - Companhia de Seguros/.test(all)) {
    const isProposal = pages[0]?.items.some((item) => normalize(item.str) === 'PROPOSTA DE SEGURO');
    if (isProposal) {
      const proposal = readFidelidadeProposal(pages);
      return proposal
        ? { kind: 'conditions', source: 'proposal', issuerName: 'Fidelidade', ...proposal }
        : null;
    }
    const isConditions = pages[0]?.items.some(
      (item) => normalize(item.str) === 'CONDIÇÕES PARTICULARES',
    );
    const conditions = isConditions ? readFidelidadeConditions(pages) : null;
    return conditions ? { kind: 'conditions', issuerName: 'Fidelidade', ...conditions } : null;
  }
  if (!ISSUER.test(all)) return null;
  if (/Carta Ata/.test(all)) return readRenewal(pages);
  if (/Condições Particulares da/.test(all)) return readConditions(pages);
  return null;
}
