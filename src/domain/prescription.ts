/**
 * Old charges: an invoice that bills a service provided more than six months
 * before it was issued. The supplier's right to be paid for it prescribes six
 * months after the service, but only if the customer invokes it (in writing)
 * before paying: once paid, there is no refund. The app says "you can invoke",
 * never "it is prescribed" (it cannot know about earlier demands).
 *
 * Reference (CLAUDE.md rule 6; read 2026-10-18), article 10 of Lei n.º 23/96:
 * - ERSE, electricity and natural gas, "As faturas prescrevem/caducam?":
 *   https://www.erse.pt/consumidores-de-energia/eletricidade/compreender-a-fatura/
 *   https://www.erse.pt/consumidores-de-energia/gas/compreender-a-fatura/
 * - ANACOM, electronic communications, "O operador pode cobrar-me uma fatura
 *   com mais de 6 meses?": https://www.anacom-consumidor.pt/faq-faturacao-de-servicos
 * Water and waste are left out until a regulator's page confirms the same.
 */
import { addMonths } from './early-exit';
import type { Invoice, Sector } from './types';

export const PRESCRIPTION_MONTHS = 6;

export const PRESCRIPTION_SOURCES: Partial<Record<Sector, string>> = {
  electricity: 'https://www.erse.pt/consumidores-de-energia/eletricidade/compreender-a-fatura/',
  gas: 'https://www.erse.pt/consumidores-de-energia/gas/compreender-a-fatura/',
  telecom: 'https://www.anacom-consumidor.pt/faq-faturacao-de-servicos',
};

export function prescriptionApplies(sector: Sector): boolean {
  return PRESCRIPTION_SOURCES[sector] !== undefined;
}

export interface OldCharges {
  invoiceId: string;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  /** Last day of the billed period that is more than six months before the invoice. */
  oldUntil: string;
}

/** The part of the billed period older than six months at the invoice date, if any. */
export function oldCharges(
  invoice: Pick<Invoice, 'id' | 'issueDate' | 'periodStart' | 'periodEnd'>,
): OldCharges | null {
  const { periodStart, periodEnd } = invoice;
  if (!periodStart || !periodEnd) return null;
  // Services up to this day were provided more than six months before the invoice.
  const limit = addMonths(invoice.issueDate, -PRESCRIPTION_MONTHS);
  if (periodStart >= limit) return null;
  const dayBefore = new Date(Date.parse(`${limit}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    invoiceId: invoice.id,
    issueDate: invoice.issueDate,
    periodStart,
    periodEnd,
    oldUntil: periodEnd < dayBefore ? periodEnd : dayBefore,
  };
}
