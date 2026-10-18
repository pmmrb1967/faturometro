import { useLiveQuery } from 'dexie-react-hooks';
import {
  contractsWithSocialTariff,
  SOCIAL_TARIFF_SOURCES,
  socialTariffSuggestions,
  WATER_SOCIAL_TARIFF_SOURCE,
} from '../../domain/social-tariff';
import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import './social-tariff.css';

const copy = t.socialTariff;

/** On a contract that may also have a social tariff: why, and how to ask for it. */
export function SocialTariffAdvice({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const suggestion = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, invoices, lines] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.invoices.list(),
      session.repos.invoiceLines.list(),
    ]);
    const withSocialTariff = contractsWithSocialTariff(contracts, invoices, lines);
    return (
      socialTariffSuggestions(contracts, withSocialTariff).find(
        (candidate) => candidate.contractId === contract.id,
      )?.suggestion ?? null
    );
  }, [session, contract]);
  if (!suggestion) return null;

  const kind = suggestion === 'internet' ? 'internet' : suggestion === 'water' ? 'water' : 'energy';
  const links =
    kind === 'energy'
      ? [
          { href: SOCIAL_TARIFF_SOURCES.dgeg, label: copy.links.dgeg },
          { href: SOCIAL_TARIFF_SOURCES.energy, label: copy.links.energy },
        ]
      : kind === 'internet'
        ? [{ href: SOCIAL_TARIFF_SOURCES.internet, label: copy.links.internet }]
        : [{ href: WATER_SOCIAL_TARIFF_SOURCE, label: copy.links.water }];

  return (
    <section className="social-advice" aria-labelledby="social-advice-title">
      <h2 id="social-advice-title" className="section-title">
        {copy.advice.title}
      </h2>
      <p>{copy.advice.why[suggestion]}</p>
      <ol>
        {copy.advice.steps[kind].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {kind !== 'internet' && <p className="muted">{copy.advice.holder}</p>}
      <p className="muted">
        {copy.advice.more}{' '}
        {links.map((link, index) => (
          <span key={link.href}>
            {index > 0 && ' · '}
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </span>
        ))}
      </p>
    </section>
  );
}
