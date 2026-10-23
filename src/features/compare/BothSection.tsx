import type { BothComparison } from '../../domain/compare-gas';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';
import { OfferList } from './OfferList';
import { sharedSheets, sheetUrl } from './offer-link';

const copy = t.compare;
const bothCopy = copy.both;

/** Electricity + gas: current total, best separate pair, cheapest dual offers. */
export function BothSection({ comparison }: { comparison: BothComparison }) {
  const cheaper = comparison.duals.filter((item) => item.savingCents > 0);
  const separate = comparison.bestSeparate;
  const separateShared = separate
    ? sharedSheets([separate.electricity.offer, separate.gas.offer])
    : new Set<string>();
  return (
    <>
      <section className="compare-current" aria-labelledby="compare-both-current">
        <h2 id="compare-both-current">{bothCopy.current}</h2>
        <p className="compare-amount">
          {formatCents(comparison.currentAnnualCents)}
          <span>{copy.perYear}</span>
        </p>
      </section>
      {separate && (
        <section className="compare-current" aria-labelledby="compare-both-separate">
          <h2 id="compare-both-separate">{bothCopy.separate}</h2>
          <p className="compare-amount">
            {formatCents(separate.annualCents)}
            <span>{copy.perYear}</span>
          </p>
          <p className="offer-saving">
            {separate.savingCents > 0
              ? copy.saving(formatCents(separate.savingCents))
              : copy.moreExpensive(formatCents(-separate.savingCents))}
          </p>
          <p className="muted offer-vat">{copy.summary.withoutVat}</p>
          <ol className="offers">
            <OfferCard
              offer={separate.electricity.offer}
              detail={[
                copy.summary.electricity,
                copy.cycles[separate.electricity.cycle],
                separate.electricity.meterCycle &&
                  copy.meterCycles[separate.electricity.meterCycle],
              ]
                .filter(Boolean)
                .join(' · ')}
              annualCents={separate.electricity.annualCents}
              electricity={{ prices: separate.electricity.prices }}
              sharedSheet={separateShared.has(sheetUrl(separate.electricity.offer) ?? '')}
            />
            <OfferCard
              offer={separate.gas.offer}
              detail={copy.summary.gas}
              annualCents={separate.gas.annualCents}
              gas={{ prices: separate.gas.prices }}
              sharedSheet={separateShared.has(sheetUrl(separate.gas.offer) ?? '')}
            />
          </ol>
        </section>
      )}
      <h2 className="section-title">{bothCopy.duals}</h2>
      {cheaper.length === 0 && <p className="muted">{bothCopy.noneDual}</p>}
      {cheaper.length > 0 && <p className="muted offer-vat">{copy.summary.withoutVat}</p>}
      <OfferList
        items={cheaper}
        offerOf={(item) => item.offer}
        render={(item, sharedSheet) => (
          <OfferCard
            key={item.offer.id}
            offer={item.offer}
            detail={copy.cycles[item.cycle]}
            annualCents={item.annualCents}
            savingCents={item.savingCents}
            electricity={item.electricity}
            gas={item.gas}
            sharedSheet={sharedSheet}
          />
        )}
      />
    </>
  );
}
