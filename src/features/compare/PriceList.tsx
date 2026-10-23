import type { CyclePrices, GasPrices } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { unitPrice } from './format';

const summary = t.compare.summary;

/** Electricity energy prices of a cycle, labelled by period. */
function energyPrices(prices: CyclePrices): string {
  const parts = (
    [
      [summary.periods.simple, prices.simple],
      [summary.periods.offEmpty, prices.offEmpty],
      [summary.periods.peak, prices.peak],
      [summary.periods.full, prices.full],
      [summary.periods.empty, prices.empty],
    ] as [string, number | undefined][]
  ).filter((entry): entry is [string, number] => entry[1] !== undefined);
  return parts.map(([label, value]) => summary.perKwh(label, unitPrice.format(value))).join(' · ');
}

/** Power and energy prices, gas fixed term and energy: "Luz" and "Gás" when both are given. */
export function PriceList({ electricity, gas }: { electricity?: CyclePrices; gas?: GasPrices }) {
  if (!electricity && !gas) return null;
  return (
    <dl className="offer-prices">
      {electricity && (
        <div>
          <dt>{gas ? summary.electricity : summary.prices}</dt>
          <dd>
            {summary.perDay(summary.power, unitPrice.format(electricity.fixedPerDay))}
            {' · '}
            {energyPrices(electricity)}
          </dd>
        </div>
      )}
      {gas && (
        <div>
          <dt>{electricity ? summary.gas : summary.prices}</dt>
          <dd>
            {summary.perDay(summary.gasFixed, unitPrice.format(gas.fixedPerDay))}
            {' · '}
            {summary.perKwh(summary.periods.simple, unitPrice.format(gas.perKwh))}
          </dd>
        </div>
      )}
    </dl>
  );
}
