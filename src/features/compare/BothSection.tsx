import type { BothComparison } from '../../domain/compare-gas';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';
import { sharedSheets, sheetUrl } from './offer-link';

const copy = t.compare;
const bothCopy = copy.both;
const TOP = 5;

/** Electricity + gas: current total, best separate pair, cheapest dual offers. */
export function BothSection({ comparison }: { comparison: BothComparison }) {
  const cheaper = comparison.duals.filter((item) => item.savingCents > 0);
  const separate = comparison.bestSeparate;
  const shown = cheaper.slice(0, TOP);
  const shared = sharedSheets(shown.map((item) => item.offer));
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
          <p>{bothCopy.separatePair(separate.electricity.offer.name, separate.gas.offer.name)}</p>
          <p className="offer-saving">
            {separate.savingCents > 0
              ? copy.saving(formatCents(separate.savingCents))
              : copy.moreExpensive(formatCents(-separate.savingCents))}
          </p>
        </section>
      )}
      <h2 className="section-title">{bothCopy.duals}</h2>
      {cheaper.length === 0 && <p className="muted">{bothCopy.noneDual}</p>}
      {shown.length > 0 && <p className="muted offer-vat">{copy.summary.withoutVat}</p>}
      <ol className="offers">
        {shown.map((item) => (
          <OfferCard
            key={item.offer.id}
            offer={item.offer}
            detail={copy.cycles[item.cycle]}
            annualCents={item.annualCents}
            savingCents={item.savingCents}
            electricity={item.electricity}
            gas={item.gas}
            sharedSheet={shared.has(sheetUrl(item.offer) ?? '')}
          />
        ))}
      </ol>
    </>
  );
}
