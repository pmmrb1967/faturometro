import type { CyclePrices, GasPrices, Offer } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { unitPrice } from './format';
import { sheetUrl, withTextFragment } from './offer-link';
import { PriceList } from './PriceList';

const copy = t.compare;
const summary = copy.summary;
const percent = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });
const euros = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Discounts included in the estimate, as the supplier gave them to the ERSE: one line per part. */
function discounts(offer: Offer, electricity: boolean, gas: boolean): string[] {
  const pct = (value: number) => percent.format(value * 100);
  const part = (
    prefix: string,
    { fixedTermPct, energyPct, energyPerKwh }: Offer['gasDiscounts'],
  ): string | null => {
    const items = [
      fixedTermPct ? summary.discountFixed(pct(fixedTermPct)) : null,
      energyPct ? summary.discountEnergy(pct(energyPct)) : null,
      energyPerKwh ? summary.discountPerKwh(unitPrice.format(energyPerKwh)) : null,
    ].filter((item): item is string => item !== null);
    return items.length > 0 ? `${prefix}${items.join(', ')}` : null;
  };
  return [
    offer.discounts.fixedPerYear
      ? summary.discountPerYear(euros.format(offer.discounts.fixedPerYear))
      : null,
    electricity ? part(gas ? summary.electricityPrefix : '', offer.discounts) : null,
    gas ? part(electricity ? summary.gasPrefix : '', offer.gasDiscounts) : null,
  ].filter((line): line is string => line !== null);
}

/**
 * One offer: name, supplier (and cycle), yearly estimate, saving, the prices
 * used for it, conditions, and the supplier's page.
 */
export function OfferCard({
  offer,
  detail,
  annualCents,
  savingCents,
  electricity,
  gas,
  sharedSheet = false,
}: {
  offer: Offer;
  /** E.g. the electricity cycle ("Simples"). */
  detail?: string;
  annualCents: number;
  /** Against the current contract; left out for one part of a separate pair. */
  savingCents?: number;
  /** Electricity prices used; with the yearly part on a dual offer. */
  electricity?: { prices: CyclePrices; annualCents?: number };
  /** Gas prices used; with the yearly part on a dual offer. */
  gas?: { prices: GasPrices; annualCents?: number };
  /** The supplier gave the same page for other offers of this list. */
  sharedSheet?: boolean;
}) {
  const conditions = copy.conditions;
  const newClients = offer.newClientDiscounts;
  const newGas = offer.gasNewClientDiscounts;
  const hasNewClientDiscount = Boolean(
    newClients.fixedPerYearWithVat ||
    newClients.fixedTermPct ||
    newClients.energyPct ||
    newClients.energyPerKwh ||
    newGas.fixedTermPct ||
    newGas.energyPct ||
    newGas.energyPerKwh,
  );
  const tags = (
    [
      [offer.loyalty, conditions.loyalty],
      [offer.indexedPrices, conditions.indexed],
      [offer.requiredServices, conditions.requiredServices],
      [offer.restrictions, conditions.restrictions],
      [
        offer.payment.directDebit && !offer.payment.multibanco && !offer.payment.cash,
        conditions.directDebitOnly,
      ],
      [offer.billing.electronic && !offer.billing.paper, conditions.electronicOnly],
      [hasNewClientDiscount, conditions.newClients],
    ] as [boolean, string][]
  )
    .filter(([applies]) => applies)
    .map(([, label]) => label);

  const split =
    electricity?.annualCents !== undefined && gas?.annualCents !== undefined
      ? summary.split(formatCents(electricity.annualCents), formatCents(gas.annualCents))
      : null;
  const included = discounts(offer, electricity !== undefined, gas !== undefined);
  const notes = [
    offer.loyalty && offer.texts.loyalty ? [summary.loyalty, offer.texts.loyalty] : null,
    offer.texts.restrictions ? [summary.restrictions, offer.texts.restrictions] : null,
    offer.texts.priceUpdates ? [summary.priceUpdates, offer.texts.priceUpdates] : null,
  ].filter((note): note is [string, string] => note !== null);
  const url = sheetUrl(offer);

  return (
    <li className="offer">
      <div className="offer-head">
        <div>
          <strong>{offer.name}</strong>
          <span className="muted">
            {offer.supplier}
            {detail ? ` · ${detail}` : ''}
          </span>
        </div>
        <p className="compare-amount">
          {formatCents(annualCents)}
          <span>{copy.perYear}</span>
        </p>
      </div>
      {savingCents !== undefined && (
        <p className="offer-saving">{copy.saving(formatCents(savingCents))}</p>
      )}
      {split && <p className="offer-split">{split}</p>}
      <PriceList electricity={electricity?.prices} gas={gas?.prices} />
      {tags.length > 0 && (
        <ul className="offer-tags">
          {tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      {(included.length > 0 || offer.validTo || notes.length > 0) && (
        <details className="offer-details">
          <summary>{summary.more}</summary>
          <dl>
            {included.length > 0 && (
              <div>
                <dt>{summary.discounts}</dt>
                {included.map((line) => (
                  <dd key={line}>{line}</dd>
                ))}
              </div>
            )}
            {offer.validTo && (
              <div>
                <dt>{summary.available}</dt>
                <dd>{summary.until(formatIsoDate(offer.validTo))}</dd>
              </div>
            )}
            {notes.map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">{summary.source}</p>
        </details>
      )}
      {url && (
        <p className="offer-sheet">
          {sharedSheet && (
            <span className="muted">{copy.sharedSheet(offer.supplier, offer.name)}</span>
          )}
          <a href={withTextFragment(url, offer.name)} target="_blank" rel="noreferrer">
            {copy.sheet}
          </a>
        </p>
      )}
    </li>
  );
}
