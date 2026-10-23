import { Link } from 'react-router';
import { SelectField } from '../../components/Field';
import type { Comparison } from '../../domain/compare';
import { PERIODS_MAPS, type PeriodsMap } from '../../domain/time-cycles';
import type { Contract, Provider } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';
import { sharedSheets, sheetUrl } from './offer-link';

const copy = t.compare;
const TOP = 5;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/** Electricity: current contract and the cheapest electricity-only offers. */
export function ElectricitySection({
  comparison,
  contract,
  provider,
  profile,
  periodsMap,
  onPeriodsMap,
}: {
  comparison: Comparison;
  contract: Contract;
  provider?: Provider;
  /** The contract's E-Redes export, if imported. */
  profile: { daysInLastYear: number } | null;
  periodsMap: PeriodsMap;
  onPeriodsMap: (map: PeriodsMap) => void;
}) {
  const { source } = comparison.usage;
  // Dual offers are compared in "Luz + gás", where their gas part is counted too.
  const cheaper = comparison.results.filter(
    (result) => result.offer.supply === 'ELE' && result.savingCents > 0,
  );
  const shown = cheaper.slice(0, TOP);
  const shared = sharedSheets(shown.map((result) => result.offer));
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
        {source ? (
          <p className="muted">
            {copy.usageEredes(formatIsoDate(source.from), formatIsoDate(source.to))}
          </p>
        ) : (
          comparison.usage.daysCovered < 365 && (
            <p className="muted">{copy.usageExtrapolated(comparison.usage.daysCovered)}</p>
          )
        )}
        {!source && profile && <p className="muted">{copy.eredesStale(profile.daysInLastYear)}</p>}
        {!profile && (
          <p className="muted">
            {copy.eredesHint}{' '}
            <Link to={`/app/contratos/${contract.id}`}>{copy.eredesHintLink}</Link>
          </p>
        )}
        {(contract.electricity?.powerKva ?? 0) <= 3.45 && (
          <p className="muted">{copy.lowPowerNote}</p>
        )}
      </section>
      {source && (
        <SelectField
          id="compare-periods-map"
          label={copy.periodsMap.label}
          hint={copy.periodsMap.hint}
          value={periodsMap}
          onChange={(event) => onPeriodsMap(event.target.value === '2027' ? '2027' : 'pre-2027')}
        >
          {PERIODS_MAPS.map((map) => (
            <option key={map} value={map}>
              {copy.periodsMap.options[map]}
            </option>
          ))}
        </SelectField>
      )}
      <h2 className="section-title">{copy.best}</h2>
      {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
      {shown.length > 0 && <p className="muted offer-vat">{copy.summary.withoutVat}</p>}
      <ol className="offers">
        {shown.map((result) => (
          <OfferCard
            key={`${result.offer.id}-${result.cycle}`}
            offer={result.offer}
            detail={
              result.meterCycle
                ? `${copy.cycles[result.cycle]}, ${copy.meterCycles[result.meterCycle]}`
                : copy.cycles[result.cycle]
            }
            annualCents={result.annualCents}
            savingCents={result.savingCents}
            electricity={{ prices: result.prices }}
            sharedSheet={shared.has(sheetUrl(result.offer) ?? '')}
          />
        ))}
      </ol>
    </>
  );
}
