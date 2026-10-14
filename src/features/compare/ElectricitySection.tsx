import type { Comparison } from '../../domain/compare';
import type { Contract, Provider } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';

const copy = t.compare;
const TOP = 5;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/** Electricity: current contract and the cheapest electricity-only offers. */
export function ElectricitySection({
  comparison,
  contract,
  provider,
}: {
  comparison: Comparison;
  contract: Contract;
  provider?: Provider;
}) {
  // Dual offers are compared in "Luz + gás", where their gas part is counted too.
  const cheaper = comparison.results.filter(
    (result) => result.offer.supply === 'ELE' && result.savingCents > 0,
  );
  return (
    <>
      <section className="compare-current" aria-labelledby="compare-current">
        <h2 id="compare-current">{copy.current}</h2>
        <p className="compare-amount">
          {formatCents(comparison.currentAnnualCents)}
          <span>{copy.perYear}</span>
        </p>
        <p>
          {copy.usage(kwh.format(comparison.usage.total))}
          {provider ? ` · ${provider.name}` : ''}
          {contract.tariffName ? ` · ${contract.tariffName}` : ''}
        </p>
        {comparison.usage.daysCovered < 365 && (
          <p className="muted">{copy.usageExtrapolated(comparison.usage.daysCovered)}</p>
        )}
        {(contract.electricity?.powerKva ?? 0) <= 3.45 && (
          <p className="muted">{copy.lowPowerNote}</p>
        )}
      </section>
      <h2 className="section-title">{copy.best}</h2>
      {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
      <ol className="offers">
        {cheaper.slice(0, TOP).map((result) => (
          <OfferCard
            key={`${result.offer.id}-${result.cycle}`}
            offer={result.offer}
            detail={copy.cycles[result.cycle]}
            annualCents={result.annualCents}
            savingCents={result.savingCents}
          />
        ))}
      </ol>
    </>
  );
}
