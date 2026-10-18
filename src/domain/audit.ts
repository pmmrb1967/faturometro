/**
 * Invoice audit (PLAN.md §13, next actions): what changed in an invoice
 * compared with the previous one of the same contract, line by line, and
 * against the monthly price the user says was contracted. Facts only: it
 * never says whether a change is allowed (CLAUDE.md rule 6).
 */
import type { Cents } from '../lib/money';
import type { Contract, Invoice, InvoiceLine, Sector } from './types';

type Line = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice' | 'period'
>;

export type AuditFinding =
  /** A unit price (€/kWh, €/day, €/m³…) changed. */
  | { kind: 'price_changed'; description: string; unit?: string; before: string; after: string }
  /** A fixed charge (monthly fee, add-on, equipment) changed. */
  | { kind: 'fee_changed'; description: string; beforeCents: Cents; afterCents: Cents }
  /** A discount of the previous invoice is gone. */
  | { kind: 'discount_ended'; description: string; amountCents: Cents }
  /** A fixed discount got smaller (not checked on energy, where discounts follow consumption). */
  | { kind: 'discount_reduced'; description: string; beforeCents: Cents; afterCents: Cents }
  /** A charge that was not on the previous invoice. */
  | { kind: 'new_charge'; description: string; amountCents: Cents }
  /** Recurring charges above the monthly price the user entered for the contract. */
  | { kind: 'above_contracted'; contractedCents: Cents; chargedCents: Cents }
  /** Telecom usage outside the package (roaming, extra traffic…), without VAT. */
  | { kind: 'extra_usage'; description: string; amountCents: Cents };

export interface InvoiceAudit {
  invoiceId: string;
  previousInvoiceId?: string;
  /** False when neither invoice has detailed lines (read from the QR code only). */
  detailed: boolean;
  findings: AuditFinding[];
  /** Something costs more than before (or than contracted). */
  increased: boolean;
  /** The invoice is from before the end of the loyalty period. */
  duringLoyalty: boolean;
}

/** Sectors where a contracted monthly price makes sense (fixed price, not consumption). */
export const MONTHLY_PRICE_SECTORS: readonly Sector[] = ['telecom', 'other'];
const ENERGY_SECTORS: readonly Sector[] = ['electricity', 'gas', 'water'];
const FIXED_KINDS: readonly InvoiceLine['kind'][] = ['base_fee', 'addon', 'equipment'];
/** Usage (calls, roaming…) comes and goes with consumption: not a new charge. */
const NEW_CHARGE_KINDS: readonly InvoiceLine['kind'][] = [
  'base_fee',
  'addon',
  'equipment',
  'other',
];
/** Differences below this are rounding. */
const TOLERANCE_CENTS = 5;

/** Same line on two invoices: kind, period and description without numbers or dates. */
export function lineKey(line: Pick<Line, 'kind' | 'period' | 'description'>): string {
  const text = line.description
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // Tiers ("1º escalão") stay apart; other numbers (dates, amounts) are dropped.
    .replace(/(\d+)\s*[ºª]/g, (_, n: string) => ` tier${'abcdefghij'[Number(n) % 10]} `)
    .replace(/[\d.,/%€:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${line.kind}|${line.period ?? ''}|${text}`;
}

function group(lines: readonly Line[]): Map<string, Line[]> {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    // Taxes (IEC, audiovisual contribution…) are set by law, not by the supplier.
    if (line.kind === 'tax') continue;
    if (line.amountCents === 0 && line.unitPrice === undefined) continue;
    const key = lineKey(line);
    const list = groups.get(key);
    if (list) list.push(line);
    else groups.set(key, [line]);
  }
  return groups;
}

const sum = (lines: readonly Line[]) => lines.reduce((total, line) => total + line.amountCents, 0);

/** The price in force at the end of the period: the last priced line with a positive quantity. */
function lastPrice(lines: readonly Line[]): string | undefined {
  return lines.filter((line) => line.unitPrice !== undefined && (line.quantity ?? 1) > 0).at(-1)
    ?.unitPrice;
}

/**
 * Recurring charges with VAT (fixed charges and discounts). Lines that add up
 * to the net amount are scaled to the total, which is exact with a single VAT
 * rate (telecom) and close otherwise. Null without such lines.
 */
export function recurringCents(invoice: Pick<Invoice, 'totalCents'>, lines: readonly Line[]) {
  const recurring = lines.filter(
    (line) => FIXED_KINDS.includes(line.kind) || line.kind === 'discount',
  );
  if (!recurring.some((line) => FIXED_KINDS.includes(line.kind))) return null;
  const all = sum(lines);
  const net = sum(recurring);
  const includesVat = Math.abs(all - invoice.totalCents) <= 1 || all === 0;
  return includesVat ? net : Math.round((net * invoice.totalCents) / all);
}

export interface AuditInput {
  contract: Pick<Contract, 'sector' | 'loyaltyEndDate' | 'monthlyPriceCents'>;
  invoice: Pick<Invoice, 'id' | 'issueDate' | 'totalCents' | 'extraUsage'>;
  lines: readonly Line[];
  previous?: Pick<Invoice, 'id' | 'totalCents'>;
  previousLines?: readonly Line[];
}

export function auditInvoice(input: AuditInput): InvoiceAudit {
  const { contract, invoice, previous } = input;
  const energy = ENERGY_SECTORS.includes(contract.sector);
  const now = group(input.lines);
  const before = group(input.previousLines ?? []);
  let findings: AuditFinding[] = [];

  if (previous && before.size > 0 && now.size > 0) {
    for (const [key, lines] of now) {
      const first = lines[0]!;
      const old = before.get(key);
      if (!old) {
        if (NEW_CHARGE_KINDS.includes(first.kind) && sum(lines) > 0) {
          findings.push({
            kind: 'new_charge',
            description: first.description,
            amountCents: sum(lines),
          });
        }
        continue;
      }
      const priceNow = lastPrice(lines);
      const priceBefore = lastPrice(old);
      if (priceNow !== undefined && priceBefore !== undefined) {
        if (Number(priceNow) !== Number(priceBefore)) {
          findings.push({
            kind: 'price_changed',
            description: first.description,
            ...(first.unit ? { unit: first.unit } : {}),
            before: priceBefore,
            after: priceNow,
          });
        }
        continue;
      }
      if (FIXED_KINDS.includes(first.kind)) {
        const [was, is] = [sum(old), sum(lines)];
        if (Math.abs(is - was) >= TOLERANCE_CENTS) {
          findings.push({
            kind: 'fee_changed',
            description: first.description,
            beforeCents: was,
            afterCents: is,
          });
        }
      } else if (first.kind === 'discount' && !energy) {
        // Discounts are negative: a smaller discount is a larger (less negative) amount.
        const [was, is] = [sum(old), sum(lines)];
        if (is - was >= TOLERANCE_CENTS) {
          findings.push({
            kind: 'discount_reduced',
            description: first.description,
            beforeCents: -was,
            afterCents: -is,
          });
        }
      }
    }
    for (const [key, old] of before) {
      const first = old[0]!;
      if (first.kind === 'discount' && !now.has(key) && sum(old) < 0) {
        findings.push({
          kind: 'discount_ended',
          description: first.description,
          amountCents: -sum(old),
        });
      }
    }

    // A discount that ends together with a smaller fee (e.g. a prorated first
    // invoice) costs nothing: only report discounts when the fixed charges rose.
    if (!energy && previous) {
      const recurringNow = recurringCents(invoice, input.lines);
      const recurringBefore = recurringCents(previous, input.previousLines ?? []);
      if (
        recurringNow !== null &&
        recurringBefore !== null &&
        recurringNow - recurringBefore < TOLERANCE_CENTS
      ) {
        findings = findings.filter(
          (finding) => finding.kind !== 'discount_ended' && finding.kind !== 'discount_reduced',
        );
      }
    }
  }

  const contracted = contract.monthlyPriceCents;
  if (contracted !== undefined && MONTHLY_PRICE_SECTORS.includes(contract.sector)) {
    const charged = recurringCents(invoice, input.lines) ?? invoice.totalCents;
    if (charged - contracted >= TOLERANCE_CENTS) {
      findings.push({
        kind: 'above_contracted',
        contractedCents: contracted,
        chargedCents: charged,
      });
    }
  }

  for (const usage of invoice.extraUsage ?? []) {
    if (usage.amountCents > 0) findings.push({ kind: 'extra_usage', ...usage });
  }

  const increased = findings.some((finding) => {
    switch (finding.kind) {
      case 'extra_usage':
        return false;
      case 'price_changed':
        return Number(finding.after) > Number(finding.before);
      case 'fee_changed':
        return finding.afterCents > finding.beforeCents;
      default:
        return true;
    }
  });

  return {
    invoiceId: invoice.id,
    ...(previous ? { previousInvoiceId: previous.id } : {}),
    detailed: now.size > 0,
    findings,
    increased,
    duringLoyalty: Boolean(contract.loyaltyEndDate && invoice.issueDate <= contract.loyaltyEndDate),
  };
}

/** Findings that the price-increase alert does not already cover (for their own alert). */
export function needsAuditAlert(audit: InvoiceAudit): boolean {
  return audit.findings.some((finding) =>
    [
      'discount_ended',
      'discount_reduced',
      'new_charge',
      'above_contracted',
      'extra_usage',
    ].includes(finding.kind),
  );
}
