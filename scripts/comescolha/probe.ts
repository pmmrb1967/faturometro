/**
 * Checks that COM.escolha still applies each filter the app sends: a filtered
 * search must return fewer results than the unfiltered one. If ANACOM ignores
 * a parameter, its links would silently open an unfiltered search.
 */
import { comEscolhaUrl, type ComEscolhaConfig } from '../../src/domain/comescolha';
import { TELECOM_SERVICES, type TelecomService } from '../../src/domain/types';

/** Results of a search address, or null when the page has no count. */
export type Count = (url: string) => Promise<number | null>;

/** Azores (Horta): fewer offers than the whole country. */
const REMOTE_POSTAL_PREFIX = '9900';
/** 1 € a month: no offer is that cheap, so the limit must cut results. */
const TINY_LIMIT_CENTS = 100;

export async function probe(config: ComEscolhaConfig, count: Count): Promise<string[]> {
  const problems: string[] = [];
  const run = async (services: TelecomService[], extra: object = {}) => {
    const url = comEscolhaUrl(config, { services, ...extra });
    return url ? count(url) : null;
  };

  const searches: [string, TelecomService[]][] = [
    ['combined', ['internet', 'tv', 'landline']],
    ...TELECOM_SERVICES.map((service): [string, TelecomService[]] => [service, [service]]),
  ];
  for (const [name, services] of searches) {
    const all = await run(services);
    if (!all) {
      problems.push(`${name}: no results without filters`);
      continue;
    }
    const limited = await run(services, { monthlyLimitCents: TINY_LIMIT_CENTS });
    if (limited === null || limited >= all) {
      problems.push(`${name}: monthly limit ignored (${limited} of ${all})`);
    }
    if (name !== 'combined') continue;
    const remote = await run(services, { postalPrefix: REMOTE_POSTAL_PREFIX });
    if (remote === null || remote >= all) {
      problems.push(`${name}: postal code ignored (${remote} of ${all})`);
    }
    const fewer = await run(['internet', 'tv']);
    if (fewer === null || fewer === all) {
      problems.push(`${name}: services ignored (${fewer} and ${all})`);
    }
  }
  return problems;
}
