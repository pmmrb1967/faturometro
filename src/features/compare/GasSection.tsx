import { SelectField } from '../../components/Field';
import type { GasComparison } from '../../domain/compare-gas';
import type { GasView } from './views';
import { distributorName, GAS_DISTRIBUTORS } from '../../domain/gas-distributors';
import type { Contract, Provider } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';
import { OfferList } from './OfferList';
import { PriceList } from './PriceList';

const copy = t.compare;
const gasCopy = copy.gas;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/** Gas: escalão and distributor, current contract and the cheapest gas-only offers. */
export function GasSection({
  view,
  comparison,
  contract,
  provider,
  missingTaxes,
  onChange,
}: {
  view: GasView;
  comparison: GasComparison | null;
  contract: Contract;
  provider?: Provider;
  /** The invoice the charges come from has no land-use fee nor excise tax line. */
  missingTaxes: boolean;
  onChange: (gas: NonNullable<Contract['gas']>) => void;
}) {
  const gas = contract.gas ?? {};
  const cheaper = (comparison?.results ?? []).filter(
    (result) => result.offer.supply === 'GN' && result.savingCents > 0,
  );
  return (
    <>
      <div className="compare-settings">
        <SelectField
          id="gas-escalao"
          label={gasCopy.escalao}
          hint={gasCopy.escalaoHint}
          value={gas.escalao ? String(gas.escalao) : ''}
          onChange={(event) =>
            onChange({ ...gas, escalao: Number(event.target.value) as 1 | 2 | 3 | 4 })
          }
        >
          {!gas.escalao && <option value="">{gasCopy.escalaoChoose}</option>}
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="gas-distributor"
          label={gasCopy.distributor}
          hint={gasCopy.distributorHint}
          value={gas.distributor ?? ''}
          onChange={(event) => onChange({ ...gas, distributor: event.target.value })}
        >
          {!gas.distributor && <option value="">{gasCopy.distributorChoose}</option>}
          {GAS_DISTRIBUTORS.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
          <option value="unknown">{gasCopy.distributorUnknown}</option>
        </SelectField>
      </div>

      {view === 'needsEscalao' && <p className="compare-note">{gasCopy.needsEscalao}</p>}
      {view === 'cannotEstimate' && <p className="compare-note">{gasCopy.cannotEstimate}</p>}
      {view === 'ready' && comparison && (
        <>
          <section className="compare-current" aria-labelledby="compare-gas-current">
            <h2 id="compare-gas-current">{copy.current}</h2>
            <p className="compare-amount">
              {formatCents(comparison.currentAnnualCents)}
              <span>{copy.perYear}</span>
            </p>
            <p>
              {gasCopy.usage(kwh.format(comparison.usage.total))}
              {provider ? ` · ${provider.name}` : ''}
              {contract.tariffName ? ` · ${contract.tariffName}` : ''}
            </p>
            <PriceList gas={comparison.currentPrices} />
            <p className="muted">
              {copy.summary.current} {copy.summary.currentGas}
            </p>
            {comparison.usage.daysCovered < 365 && (
              <p className="ingest-problem">{gasCopy.seasonal}</p>
            )}
            {missingTaxes && <p className="muted">{gasCopy.missingTaxes}</p>}
            {comparison.regulated && (
              <p className="muted">
                {gasCopy.regulated(
                  distributorName(comparison.regulated.code),
                  formatCents(comparison.regulated.annualCents),
                )}
              </p>
            )}
          </section>
          <h2 className="section-title">{copy.best}</h2>
          {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
          {cheaper.length > 0 && <p className="muted offer-vat">{copy.summary.withoutVat}</p>}
          <OfferList
            items={cheaper}
            offerOf={(result) => result.offer}
            render={(result, sharedSheet) => (
              <OfferCard
                key={result.offer.id}
                offer={result.offer}
                annualCents={result.annualCents}
                savingCents={result.savingCents}
                gas={{ prices: result.prices }}
                sharedSheet={sharedSheet}
              />
            )}
          />
        </>
      )}
    </>
  );
}
