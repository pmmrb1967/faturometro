import type { Repositories } from '../../db/repositories';
import { switchSavings, type SwitchInvoice, type SwitchSavings } from '../../domain/switch-savings';
import type { Contract } from '../../domain/types';
import { getSettings } from '../settings/settings';

async function entriesOf(repos: Repositories, contract: Contract): Promise<SwitchInvoice[]> {
  const invoices = await repos.invoices.findBy('contractId', contract.id);
  return Promise.all(
    invoices.map(async (invoice) => ({
      invoice,
      lines: await repos.invoiceLines.findBy('invoiceId', invoice.id),
    })),
  );
}

/** Savings since `old` was replaced by `current` (null without anything to compare). */
export async function savingsBetween(
  repos: Repositories,
  old: Contract,
  current: Contract,
): Promise<SwitchSavings | null> {
  if (!old.endedAt) return null;
  const [before, after, settings] = await Promise.all([
    entriesOf(repos, old),
    entriesOf(repos, current),
    getSettings(repos),
  ]);
  const powerKva = current.electricity?.powerKva ?? old.electricity?.powerKva;
  return switchSavings({
    sector: current.sector,
    since: old.endedAt,
    before,
    after,
    ...(powerKva ? { household: { powerKva, largeFamily: settings.largeFamily } } : {}),
  });
}

/** The contract this one replaced, and the savings since then. */
export async function replacedContract(
  repos: Repositories,
  contract: Contract,
): Promise<{ previous: Contract; savings: SwitchSavings | null } | null> {
  const previous = (await repos.contracts.list()).find(
    (other) => other.replacedById === contract.id,
  );
  if (!previous) return null;
  return { previous, savings: await savingsBetween(repos, previous, contract) };
}

/** Sum of the estimated savings of every change of supplier (null when there is none to compare). */
export async function totalSwitchSavings(repos: Repositories): Promise<number | null> {
  const contracts = await repos.contracts.list();
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const results = await Promise.all(
    contracts.map((old) => {
      const current = old.replacedById ? byId.get(old.replacedById) : undefined;
      return current ? savingsBetween(repos, old, current) : Promise.resolve(null);
    }),
  );
  const known = results.filter((result): result is SwitchSavings => result !== null);
  return known.length > 0 ? known.reduce((sum, result) => sum + result.savingCents, 0) : null;
}
