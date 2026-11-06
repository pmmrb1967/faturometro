/**
 * Via Verde statements were saved as "Outras despesas" before the sector
 * "Transportes" existed. Moves those contracts (and their providers) to
 * `transport`, once: nothing is written when there is nothing to move, so
 * synced devices do not send the records again. Runs locally on each
 * device; the sync merges the same result by last-write-wins.
 */
import type { Repositories } from '../../db/repositories';
import type { Sector } from '../../domain/types';

const VIA_VERDE_PARSER = 'via-verde';

/** Number of contracts moved. */
export async function moveViaVerdeToTransport(repos: Repositories): Promise<number> {
  const [contracts, invoices, providers] = await Promise.all([
    repos.contracts.list(),
    repos.invoices.list(),
    repos.providers.list(),
  ]);
  const viaVerde = new Set(
    invoices
      .filter((invoice) => invoice.parserId === VIA_VERDE_PARSER)
      .map((invoice) => invoice.contractId),
  );
  const moved = contracts.filter(
    (contract) => contract.sector === 'other' && viaVerde.has(contract.id),
  );
  if (moved.length === 0) return 0;
  const movedIds = new Set(moved.map((contract) => contract.id));
  for (const contract of moved) await repos.contracts.put({ ...contract, sector: 'transport' });

  // Providers of the moved contracts and of their invoices (each issuer of the statement).
  const touched = new Set([
    ...moved.map((contract) => contract.providerId),
    ...invoices
      .filter((invoice) => movedIds.has(invoice.contractId))
      .map((invoice) => invoice.providerId),
  ]);
  for (const provider of providers) {
    if (!touched.has(provider.id) || provider.sectors.includes('transport')) continue;
    // "other" stays when the provider still has another "other" expense.
    const stillOther =
      contracts.some(
        (contract) =>
          contract.providerId === provider.id &&
          contract.sector === 'other' &&
          !movedIds.has(contract.id),
      ) ||
      invoices.some(
        (invoice) =>
          invoice.providerId === provider.id &&
          !movedIds.has(invoice.contractId) &&
          contracts.find((contract) => contract.id === invoice.contractId)?.sector === 'other',
      );
    const sectors: Sector[] = provider.sectors.filter((sector) => stillOther || sector !== 'other');
    await repos.providers.put({ ...provider, sectors: [...sectors, 'transport'] });
  }
  return moved.length;
}
