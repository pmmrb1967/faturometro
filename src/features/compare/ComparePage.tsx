import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { SelectField } from '../../components/Field';
import {
  annualUsage,
  compareOffers,
  groupDualVariants,
  type DisplayResult,
} from '../../domain/compare';
import { offersFileSchema, type OffersFile } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { recordCheaperOffer } from './cheaper-offer';
import './compare.css';

const copy = t.compare;
const TOP = 5;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

function useOffers(): OffersFile | null | 'error' {
  const [offers, setOffers] = useState<OffersFile | null | 'error'>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/data/erse-offers.json')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((json: unknown) => {
        const parsed = offersFileSchema.safeParse(json);
        if (!cancelled) setOffers(parsed.success ? parsed.data : 'error');
      })
      .catch(() => {
        if (!cancelled) setOffers('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return offers;
}

export function ComparePage() {
  const { session } = useSession();
  const offers = useOffers();
  const [chosen, setChosen] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, providers, settings] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.providers.list(),
      getSettings(session.repos),
    ]);
    const candidates = [];
    for (const contract of contracts.filter(
      (item) => item.sector === 'electricity' && item.electricity,
    )) {
      const [invoices, readings] = await Promise.all([
        session.repos.invoices.findBy('contractId', contract.id),
        session.repos.readings.findBy('contractId', contract.id),
      ]);
      const latest = invoices
        .filter((invoice) => invoice.periodStart && invoice.periodEnd)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
      if (!latest) continue;
      const lines = await session.repos.invoiceLines.findBy('invoiceId', latest.id);
      const provider = providers.find((item) => item.id === contract.providerId);
      candidates.push({ contract, provider, invoices, readings, latest, lines });
    }
    return { candidates, settings };
  }, [session]);

  const candidate =
    data?.candidates.find((item) => item.contract.id === chosen) ?? data?.candidates[0];

  const comparison = useMemo(() => {
    if (!candidate || !data || !offers || offers === 'error' || !candidate.contract.electricity)
      return null;
    const date = today();
    const usage = annualUsage(candidate.invoices, candidate.readings, date);
    if (!usage) return null;
    return compareOffers({
      offers: offers.offers,
      latest: {
        lines: candidate.lines,
        periodStart: candidate.latest.periodStart!,
        periodEnd: candidate.latest.periodEnd!,
      },
      usage,
      household: {
        powerKva: candidate.contract.electricity.powerKva,
        largeFamily: data.settings.largeFamily,
      },
      today: date,
    });
  }, [candidate, data, offers]);

  // "Cheaper offer" alert (PLAN.md §9), once per ERSE data update.
  useEffect(() => {
    if (!session || !candidate || !comparison || !offers || offers === 'error' || !data) return;
    const best = comparison.results[0];
    void recordCheaperOffer(session.repos, {
      contract: candidate.contract,
      dataDate: offers.dataDate,
      best: best && best.savingCents >= data.settings.cheaperOfferMinSavingCents ? best : undefined,
    });
  }, [session, candidate, comparison, offers, data]);

  if (!session || !data) return null;
  const cheaper = comparison
    ? groupDualVariants(comparison.results.filter((result) => result.savingCents > 0))
    : [];

  return (
    <>
      <h1>{copy.title}</h1>
      <p className="muted compare-intro">{copy.intro}</p>
      <details className="compare-glossary">
        <summary>{copy.glossary.title}</summary>
        <dl>
          {copy.glossary.items.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{copy.glossary.source}</p>
      </details>

      {data.candidates.length === 0 && <p className="compare-note">{copy.noContract}</p>}
      {data.candidates.length > 1 && (
        <SelectField
          id="compare-contract"
          label={copy.contract}
          value={candidate?.contract.id ?? ''}
          onChange={(event) => setChosen(event.target.value)}
        >
          {data.candidates.map((item) => (
            <option key={item.contract.id} value={item.contract.id}>
              {item.contract.label} — {item.provider?.name}
            </option>
          ))}
        </SelectField>
      )}

      {offers === null && data.candidates.length > 0 && <p role="status">{copy.loading}</p>}
      {offers === 'error' && <p className="ingest-problem">{copy.offersUnavailable}</p>}

      {comparison && offers && offers !== 'error' && candidate && (
        <>
          <p className="muted">{copy.dataDate(formatIsoDate(offers.dataDate))}</p>
          <section className="compare-current" aria-labelledby="compare-current">
            <h2 id="compare-current">{copy.current}</h2>
            <p className="compare-amount">
              {formatCents(comparison.currentAnnualCents)}
              <span>{copy.perYear}</span>
            </p>
            <p>
              {copy.usage(kwh.format(comparison.usage.total))}
              {candidate.provider ? ` · ${candidate.provider.name}` : ''}
              {candidate.contract.tariffName ? ` · ${candidate.contract.tariffName}` : ''}
            </p>
            {comparison.usage.daysCovered < 365 && (
              <p className="muted">{copy.usageExtrapolated(comparison.usage.daysCovered)}</p>
            )}
            {(candidate.contract.electricity?.powerKva ?? 0) <= 3.45 && (
              <p className="muted">{copy.lowPowerNote}</p>
            )}
          </section>

          <h2 className="section-title">{copy.best}</h2>
          {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
          <ol className="offers">
            {cheaper.slice(0, TOP).map((result) => (
              <OfferCard key={`${result.offer.id}-${result.cycle}`} result={result} />
            ))}
          </ol>
          <p className="compare-disclaimer">{copy.disclaimer}</p>
        </>
      )}
    </>
  );
}

function OfferCard({ result }: { result: DisplayResult }) {
  const { offer } = result;
  const conditions = copy.conditions;
  const newClients = offer.newClientDiscounts;
  const hasNewClientDiscount = Boolean(
    newClients.fixedPerYearWithVat ||
    newClients.fixedTermPct ||
    newClients.energyPct ||
    newClients.energyPerKwh,
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
            {offer.supplier} · {copy.cycles[result.cycle]}
          </span>
        </div>
        <p className="compare-amount">
          {formatCents(result.annualCents)}
          <span>{copy.perYear}</span>
        </p>
      </div>
      <p className="offer-saving">{copy.saving(formatCents(result.savingCents))}</p>
      {offer.supply === 'DUAL' && <p className="offer-dual">{copy.dualOnly(offer.supplier)}</p>}
      {result.dualVariant && (
        <p className="muted offer-note">{copy.dualVariant(result.dualVariant.name)}</p>
      )}
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
