import type { Repositories } from '../../db/repositories';
import type { OfferResult } from '../../domain/compare';
import type { Contract } from '../../domain/types';
import { alertMessage } from '../alerts/refresh';

/**
 * Keeps one "cheaper offer" alert per contract and ERSE data date: added when
 * an offer saves at least the threshold, removed when none does. Dismissed
 * alerts stay dismissed until the next ERSE update.
 */
export async function recordCheaperOffer(
  repos: Repositories,
  input: { contract: Contract; dataDate: string; best?: OfferResult },
): Promise<void> {
  const id = `${input.contract.id}:cheaper_offer:${input.dataDate}`;
  const existing = (await repos.alerts.list()).filter(
    (alert) => alert.contractId === input.contract.id && alert.kind === 'cheaper_offer',
  );
  for (const alert of existing) {
    if (!alert.dismissedAt && (alert.id !== id || !input.best)) await repos.alerts.remove(alert.id);
  }
  const current = existing.find((alert) => alert.id === id);
  if (!input.best || current?.dismissedAt) return;
  const data = {
    savingCents: input.best.savingCents,
    offerId: input.best.offer.id,
    offerName: input.best.offer.name,
    supplier: input.best.offer.supplier,
    dataDate: input.dataDate,
  };
  if (
    current &&
    current.data?.savingCents === data.savingCents &&
    current.data.offerId === data.offerId
  )
    return;
  await repos.alerts.put({
    id,
    contractId: input.contract.id,
    kind: 'cheaper_offer',
    severity: 'info',
    message: alertMessage({ kind: 'cheaper_offer', data }, input.contract),
    data,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  });
}
