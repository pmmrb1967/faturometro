import type { Offer } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';

const copy = t.compare;

/** One offer: name, supplier (and cycle), yearly estimate, saving and conditions. */
export function OfferCard({
  offer,
  detail,
  annualCents,
  savingCents,
}: {
  offer: Offer;
  /** E.g. the electricity cycle ("Simples"). */
  detail?: string;
  annualCents: number;
  savingCents: number;
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
      <p className="offer-saving">{copy.saving(formatCents(savingCents))}</p>
      {tags.length > 0 && (
        <ul className="offer-tags">
          {tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      {(offer.links.standardSheet ?? offer.links.offer) && (
        <a href={offer.links.standardSheet ?? offer.links.offer} target="_blank" rel="noreferrer">
          {copy.sheet}
        </a>
      )}
    </li>
  );
}
