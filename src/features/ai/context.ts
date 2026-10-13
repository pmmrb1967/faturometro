import type { ContractContext } from '../../ai/prompts/assist';
import type { Repositories } from '../../db/repositories';
import type { Contract } from '../../domain/types';

const HISTORY = 4;

/** Structured data only (no names, addresses or identifiers): see src/ai/prompts/assist.ts. */
export async function contractContext(
  repos: Repositories,
  contract: Contract,
): Promise<ContractContext> {
  const [provider, invoices, alerts] = await Promise.all([
    repos.providers.get(contract.providerId),
    repos.invoices.findBy('contractId', contract.id),
    repos.alerts.list(),
  ]);
  invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const recent = invoices.slice(0, HISTORY);
  const offer = alerts.find(
    (alert) =>
      alert.contractId === contract.id && alert.kind === 'cheaper_offer' && !alert.dismissedAt,
  )?.data;
  return {
    providerName: provider?.name ?? '',
    contract: {
      sector: contract.sector,
      ...(contract.tariffName ? { tariffName: contract.tariffName } : {}),
      ...(contract.loyaltyEndDate ? { loyaltyEndDate: contract.loyaltyEndDate } : {}),
      ...(contract.electricity ? { powerKva: contract.electricity.powerKva } : {}),
    },
    invoices: await Promise.all(
      recent.map(async (invoice) => ({
        invoice,
        lines: await repos.invoiceLines.findBy('invoiceId', invoice.id),
        readings: await repos.readings.findBy('invoiceId', invoice.id),
      })),
    ),
    ...(offer && typeof offer.savingCents === 'number'
      ? {
          cheaperOffer: {
            name: `${String(offer.supplier ?? '')} — ${String(offer.offerName ?? '')}`,
            yearlySavingCents: offer.savingCents,
          },
        }
      : {}),
  };
}
