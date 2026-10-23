import type { CyclePrices, GasPrices } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { unitPrice } from './format';

const copy = t.compare;
const summary = copy.summary;

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

/** Yearly cost of one part, at the end of its row. */
function Amount({ cents }: { cents?: number }) {
  if (cents === undefined) return null;
  return (
    <dd className="offer-prices-amount">
      {formatCents(cents)}
      {copy.perYear}
    </dd>
  );
}

/**
 * Power and energy prices, gas fixed term and energy: "Luz" and "Gás" when both
 * are given, each with its yearly cost when known.
 */
export function PriceList({
  electricity,
  gas,
  electricityCents,
  gasCents,
}: {
  electricity?: CyclePrices;
  gas?: GasPrices;
  electricityCents?: number;
  gasCents?: number;
}) {
  if (!electricity && !gas) return null;
  const amounts = electricityCents !== undefined || gasCents !== undefined;
  return (
    <dl className={amounts ? 'offer-prices with-amounts' : 'offer-prices'}>
      {electricity && (
        <div>
          <dt>{gas ? summary.electricity : summary.prices}</dt>
          <dd>
            {summary.perDay(summary.power, unitPrice.format(electricity.fixedPerDay))}
            {' · '}
            {energyPrices(electricity)}
          </dd>
          <Amount cents={electricityCents} />
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
          <Amount cents={gasCents} />
        </div>
      )}
    </dl>
  );
}
