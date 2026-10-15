/**
 * Fidelidade (Multicare health insurance) particular conditions: not an
 * invoice. Header table with letter-spaced labels ("N º DE A P Ó L I C E",
 * "P R É M I O T O T A L"…) and their values just below; then a coverage table
 * whose names wrap over several lines, with values on one of them: capital,
 * share in the insurer's network (insurer / client), share by reimbursement
 * (insurer / client) and waiting period; some coverages have no values in the
 * table and are still contracted. Indented rows under a coverage
 * ("Franquia por Sinistro", "Taxas Moderadoras"…) belong to it. Layout
 * studied on a 2026 policy.
 */
import type { InsuranceCoverage, InsuranceDetails } from '../domain/types';
import type { PageText, TextItem } from '../pdf/text';
import { amount, date, normalize, rows } from './utils';

export interface FidelidadeConditions {
  title?: string;
  policyNumber?: string;
  details: InsuranceDetails;
}

/** Text without spaces: "N º DE A P Ó L I C E" → "NºDEAPÓLICE". */
const squash = (text: string) => text.replace(/\s+/g, '');

/** The value printed just below a header label (within 25 points down and 20 sideways). */
function below(page: PageText, header: RegExp): string | undefined {
  const label = page.items.find((item) => header.test(squash(item.str)));
  if (!label) return undefined;
  const value = page.items
    .filter(
      (item) =>
        item.y > label.y + 1 &&
        item.y - label.y <= 25 &&
        Math.abs(item.x - label.x) <= 20 &&
        item.str.trim() !== '' &&
        !/^[A-Z]( [A-Z])+$/.test(item.str.trim()),
    )
    .sort((a, b) => a.y - b.y)[0];
  return value ? normalize(value.str) : undefined;
}

/** "MULTICARE INDIVIDUAL" → "Multicare individual". */
function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('pt-PT');
  return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
}

/** Column edges of the coverage table (x of the values). */
const COLUMNS = {
  capital: [170, 240],
  networkInsurer: [240, 300],
  networkClient: [300, 370],
  reimbursementInsurer: [370, 440],
  reimbursementClient: [440, 505],
  waiting: [505, Infinity],
} as const;
type Column = keyof typeof COLUMNS;
/** Names start left of this x; values right of it. */
const NAME_MAX_X = 170;
/** Rows of one name block are at most this far apart, at the same indentation. */
const LINE = 16;

/** Rows under a coverage that describe it, rather than being coverages of their own. */
const ATTRIBUTE = /^(Franquia por|Taxas|Honorários|Valor Máximo)/;

interface Block {
  x: number;
  lines: string[];
  top: number;
  bottom: number;
  values: TextItem[];
}

function columnOf(item: TextItem): Column | undefined {
  return (Object.keys(COLUMNS) as Column[]).find((key) => {
    const [min, max] = COLUMNS[key];
    return item.x >= min && item.x < max;
  });
}

function joined(block: Block, column: Column): string | undefined {
  const text = block.values
    .filter((item) => columnOf(item) === column)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => normalize(item.str))
    .join('');
  return text && text !== '-' ? text : undefined;
}

function share(insurer?: string, client?: string): string | undefined {
  if (!insurer && !client) return undefined;
  return `Multicare ${insurer ?? '—'} · cliente ${client ?? '—'}`;
}

/** The coverage table of one page: from its "Coberturas" header to the next section. */
function pageCoverages(page: PageText): InsuranceCoverage[] {
  const all = rows(page);
  const header = all.findIndex((row) => row.items.some((item) => item.str.trim() === 'Coberturas'));
  if (header < 0) return [];
  // The header spans a few rows ("Capitais / Seguros", "Multicare / Cliente").
  const start = all.findIndex(
    (row, index) => index > header && row.items.some((item) => /^Cliente$/.test(item.str.trim())),
  );
  const table: typeof all = [];
  let previous = all[start]?.y ?? 0;
  for (const row of all.slice(start + 1)) {
    // The table ends at the next section or at the page footer ("05/05/2026 18:45:55 …", "Página 1 de 5").
    if (row.y - previous > 30) break;
    if (/Página \d+ de \d+|^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(row.text)) break;
    table.push(row);
    previous = row.y;
  }

  const blocks: Block[] = [];
  const values: TextItem[] = [];
  for (const row of table) {
    for (const item of row.items) {
      if (item.str.trim() === '') continue;
      if (item.x >= NAME_MAX_X) {
        values.push(item);
        continue;
      }
      const last = blocks.at(-1);
      if (last && Math.abs(last.x - item.x) <= 3 && item.y - last.bottom <= LINE) {
        last.lines.push(normalize(item.str));
        last.bottom = item.y;
      } else {
        blocks.push({
          x: item.x,
          lines: [normalize(item.str)],
          top: item.y,
          bottom: item.y,
          values: [],
        });
      }
    }
  }
  for (const value of values) {
    const distance = (block: Block) =>
      value.y < block.top
        ? block.top - value.y
        : value.y > block.bottom
          ? value.y - block.bottom
          : 0;
    const nearest = [...blocks].sort((a, b) => distance(a) - distance(b))[0];
    if (nearest && distance(nearest) <= 10) nearest.values.push(value);
  }

  const coverages: InsuranceCoverage[] = [];
  for (const block of blocks) {
    const name = block.lines.join(' ').replace(/\s+/g, ' ').trim();
    const last = coverages.at(-1);
    if (ATTRIBUTE.test(name) && last) {
      // A deductible ("Franquia por Sinistro") or another rule of the coverage above.
      if (/^Franquia/.test(name)) {
        const network = joined(block, 'networkClient') ?? joined(block, 'networkInsurer');
        const reimbursement =
          joined(block, 'reimbursementClient') ?? joined(block, 'reimbursementInsurer');
        const parts = [
          network ? `rede ${network}` : undefined,
          reimbursement ? `reembolso ${reimbursement}` : undefined,
        ].filter(Boolean);
        if (parts.length > 0) last.deductible = parts.join(' · ');
      }
      continue;
    }
    const coverage: InsuranceCoverage = { name };
    const capital = joined(block, 'capital');
    if (capital) {
      coverage.capital = capital;
      const cents = amount(capital);
      if (cents !== null) coverage.capitalCents = cents;
    }
    const network = share(joined(block, 'networkInsurer'), joined(block, 'networkClient'));
    if (network) coverage.network = network;
    const reimbursement = share(
      joined(block, 'reimbursementInsurer'),
      joined(block, 'reimbursementClient'),
    );
    if (reimbursement) coverage.reimbursement = reimbursement;
    const waiting = joined(block, 'waiting');
    if (waiting) coverage.waitingPeriod = waiting;
    // A coverage without values in the table is still contracted.
    coverages.push(coverage);
  }
  return coverages;
}

/**
 * How many people the policy covers: rows of the "Pessoa Segura | Data
 * Nascimento | Sexo | Data adesão" table (only counted; names and birth dates
 * are never read).
 */
function insuredPersons(pages: readonly PageText[]): number | undefined {
  for (const page of pages) {
    const all = rows(page);
    const header = all.findIndex((row) =>
      row.items.some((item) => normalize(item.str) === 'Pessoa Segura'),
    );
    const sex = all[header]?.items.find((item) => normalize(item.str) === 'Sexo');
    if (header < 0 || !sex) continue;
    let count = 0;
    let previous = all[header]!.y;
    for (const row of all.slice(header + 1)) {
      if (row.y - previous > 20) break;
      const mark = row.items.find((item) => Math.abs(item.x - sex.x) <= 10);
      if (!mark || !/^[MF]$/.test(mark.str.trim())) break;
      count++;
      previous = row.y;
    }
    if (count > 0) return count;
  }
  return undefined;
}

export function readFidelidadeConditions(pages: readonly PageText[]): FidelidadeConditions | null {
  const first = pages[0];
  if (!first) return null;
  const coverages = pages.flatMap(pageCoverages);
  if (coverages.length === 0) return null;
  const details: InsuranceDetails = { coverages };

  // "21 / MULTICARE INDIVIDUAL": branch code, then the product.
  const product = below(first, /^RAMO\/MODALIDADE$/)?.replace(/^\d+\s*\/\s*/, '');
  if (product) details.product = product;
  const policyNumber = below(first, /^Nº$/);
  if (policyNumber) details.policyNumber = policyNumber;
  const start = date(below(first, /^DATAINÍCIO$/));
  if (start) details.startDate = start;
  const premium = amount(below(first, /^PRÉMIOTOTAL$/));
  if (premium !== null) details.annualPremiumCents = premium;
  const persons = insuredPersons(pages);
  if (persons !== undefined) details.insuredPersons = persons;

  return {
    ...(product ? { title: `Seguro ${sentenceCase(product)}` } : {}),
    ...(policyNumber ? { policyNumber } : {}),
    details,
  };
}
