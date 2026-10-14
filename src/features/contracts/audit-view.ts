import type { Repositories } from '../../db/repositories';
import { auditInvoice, type AuditFinding, type InvoiceAudit } from '../../domain/audit';
import type { Contract, Invoice } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';

const copy = t.contracts.audit;

function unitPrice(value: string, unit?: string): string {
  const price = `${value.replace('.', ',')} €`;
  return unit ? `${price}/${copy.units[unit] ?? unit}` : price;
}

/** One sentence per finding, in Portuguese. */
export function findingText(finding: AuditFinding): string {
  switch (finding.kind) {
    case 'price_changed':
      return copy.priceChanged(
        finding.description,
        unitPrice(finding.before, finding.unit),
        unitPrice(finding.after, finding.unit),
      );
    case 'fee_changed':
      return copy.feeChanged(
        finding.description,
        formatCents(finding.beforeCents),
        formatCents(finding.afterCents),
      );
    case 'discount_ended':
      return copy.discountEnded(finding.description, formatCents(finding.amountCents));
    case 'discount_reduced':
      return copy.discountReduced(
        finding.description,
        formatCents(finding.beforeCents),
        formatCents(finding.afterCents),
      );
    case 'new_charge':
      return copy.newCharge(finding.description, formatCents(finding.amountCents));
    case 'above_contracted':
      return copy.aboveContracted(
        formatCents(finding.chargedCents),
        formatCents(finding.contractedCents),
      );
  }
}

export interface LatestAudit {
  audit: InvoiceAudit;
  invoice: Invoice;
  previous?: Invoice;
}

/** Audit of the contract's most recent invoice against the one before; null without invoices. */
export async function latestAudit(
  repos: Repositories,
  contract: Contract,
  invoices?: Invoice[],
): Promise<LatestAudit | null> {
  const own = [...(invoices ?? (await repos.invoices.findBy('contractId', contract.id)))].sort(
    (a, b) => a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt),
  );
  const invoice = own.at(-1);
  if (!invoice) return null;
  const previous = own.at(-2);
  const [lines, previousLines] = await Promise.all([
    repos.invoiceLines.findBy('invoiceId', invoice.id),
    previous ? repos.invoiceLines.findBy('invoiceId', previous.id) : Promise.resolve([]),
  ]);
  const audit = auditInvoice({
    contract,
    invoice,
    lines,
    ...(previous ? { previous, previousLines } : {}),
  });
  return { audit, invoice, ...(previous ? { previous } : {}) };
}
