/**
 * Fidelidade "Proposta de Seguro" signed by the client (pet insurance, …): not
 * an invoice. Labels with the value on their right ("Produto:", "Data
 * Início:"), the policy number in the header ("Seguro Novo Apólice Nº: …")
 * and a coverage table "Coberturas | Franquia (*) | Capital Seguro" that may go
 * on to the next page (header repeated), ended by the "(*)" notes. It has no
 * premium. Once accepted it says what the policy covers, so it is read like
 * particular conditions. Layout studied on a 2024 pet insurance proposal.
 */
import type { InsuranceCoverage, InsuranceDetails } from '../domain/types';
import type { PageText } from '../pdf/text';
import { policyTitle } from './fidelidade';
import type { FidelidadeConditions } from './fidelidade-documents';
import { amount, date, findItem, normalize, rows, valueRightOf } from './utils';

/** Rows of one table are at most this far apart. */
const MAX_ROW_GAP = 20;

function labelValue(pages: readonly PageText[], label: RegExp): string | undefined {
  for (const page of pages) {
    const item = findItem(page, label);
    const value = item ? valueRightOf(page, item) : undefined;
    if (value && normalize(value.str)) return normalize(value.str);
  }
  return undefined;
}

function pageCoverages(page: PageText): InsuranceCoverage[] {
  const all = rows(page);
  const header = all.findIndex(
    (row) =>
      row.items.some((item) => normalize(item.str) === 'Coberturas') &&
      row.items.some((item) => /^Capital Seguro$/.test(normalize(item.str))),
  );
  const head = all[header];
  if (!head) return [];
  const deductibleX = head.items.find((item) => /^Franquia/.test(normalize(item.str)))?.x;
  const capitalX = head.items.find((item) => /^Capital Seguro$/.test(normalize(item.str)))?.x;
  if (deductibleX === undefined || capitalX === undefined) return [];

  const coverages: InsuranceCoverage[] = [];
  let previous = head.y;
  for (const row of all.slice(header + 1)) {
    if (row.y - previous > MAX_ROW_GAP || /^\(\*/.test(row.text)) break;
    previous = row.y;
    const text = (from: number, to: number) =>
      normalize(
        row.items
          .filter((item) => item.x >= from && item.x < to)
          .map((item) => item.str)
          .join(' '),
      );
    const name = text(-Infinity, deductibleX - 20).replace(/\s*\(\*+\)$/, '');
    if (!name) continue;
    const coverage: InsuranceCoverage = { name };
    const capital = text(capitalX - 15, Infinity);
    if (capital) {
      coverage.capital = capital;
      const cents = amount(capital);
      if (cents !== null) coverage.capitalCents = cents;
    }
    const deductible = text(deductibleX - 20, capitalX - 15);
    if (deductible) coverage.deductible = deductible;
    coverages.push(coverage);
  }
  return coverages;
}

export function readFidelidadeProposal(pages: readonly PageText[]): FidelidadeConditions | null {
  const coverages = pages.flatMap(pageCoverages);
  if (coverages.length === 0) return null;
  const details: InsuranceDetails = { coverages };

  const product = labelValue(pages, /^Produto:$/);
  if (product) details.product = product;
  const header = pages
    .flatMap((page) => page.items)
    .map((item) => /Apólice Nº:\s*(\S+)/.exec(normalize(item.str))?.[1])
    .find(Boolean);
  if (header) details.policyNumber = header;
  const start = date(labelValue(pages, /^Data Início:$/));
  if (start) details.startDate = start;
  // What is insured: species and breed. The animal's name is never kept.
  const species = labelValue(pages, /^Espécie:$/);
  const breed = labelValue(pages, /^Raça:$/);
  if (species) details.insuredObject = breed ? `${species} (${breed})` : species;

  return {
    ...(product ? { title: policyTitle(product) } : {}),
    ...(header ? { policyNumber: header } : {}),
    details,
  };
}
