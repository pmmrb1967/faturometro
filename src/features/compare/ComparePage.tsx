import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { SelectField } from '../../components/Field';
import { annualUsage, compareOffers } from '../../domain/compare';
import { combineElectricityGas, compareGas } from '../../domain/compare-gas';
import { offersFileSchema, OFFERS_URL, type OffersFile } from '../../domain/erse';
import { hasEarlierAdjustments } from '../../domain/gas-cost';
import type { Contract, Invoice, InvoiceLine, Provider, Reading } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { BothSection } from './BothSection';
import { recordCheaperOffer } from './cheaper-offer';
import { ElectricitySection } from './ElectricitySection';
import { GasSection } from './GasSection';
import { bothView, gasView } from './views';
import './compare.css';

const copy = t.compare;
type Tab = 'electricity' | 'gas' | 'both';
const TAB_KEY = 'faturometro.compare.tab';

interface Candidate {
  contract: Contract;
  provider?: Provider;
  invoices: Invoice[];
  readings: Reading[];
  /** Invoice whose lines give the current prices and the common charges. */
  latest: Invoice;
  lines: InvoiceLine[];
}

function useOffers(): OffersFile | null | 'error' {
  const [offers, setOffers] = useState<OffersFile | null | 'error'>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(OFFERS_URL)
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

function savedTab(): Tab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return value === 'gas' || value === 'both' ? value : 'electricity';
  } catch {
    return 'electricity';
  }
}

export function ComparePage() {
  const { session } = useSession();
  const offers = useOffers();
  const [tab, setTab] = useState<Tab>(savedTab);
  const [chosenElectricity, setChosenElectricity] = useState<string | null>(null);
  const [chosenGas, setChosenGas] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, providers, settings] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.providers.list(),
      getSettings(session.repos),
    ]);
    const load = async (contract: Contract): Promise<Candidate | null> => {
      const [invoices, readings] = await Promise.all([
        session.repos.invoices.findBy('contractId', contract.id),
        session.repos.readings.findBy('contractId', contract.id),
      ]);
      const dated = invoices
        .filter((invoice) => invoice.periodStart && invoice.periodEnd)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
      const first = dated[0];
      if (!first) return null;
      let latest = first;
      let lines = await session.repos.invoiceLines.findBy('invoiceId', first.id);
      // Gas: charges from the latest invoice that does not settle earlier estimates.
      if (contract.sector === 'gas' && hasEarlierAdjustments(lines)) {
        for (const invoice of dated.slice(1)) {
          const candidate = await session.repos.invoiceLines.findBy('invoiceId', invoice.id);
          if (!hasEarlierAdjustments(candidate)) {
            latest = invoice;
            lines = candidate;
            break;
          }
        }
      }
      const provider = providers.find((item) => item.id === contract.providerId);
      return { contract, invoices, readings, latest, lines, ...(provider ? { provider } : {}) };
    };
    const loaded = async (sector: 'electricity' | 'gas') =>
      (
        await Promise.all(
          contracts
            .filter(
              (item) =>
                item.sector === sector && (sector === 'gas' || item.electricity !== undefined),
            )
            .map(load),
        )
      ).filter((item): item is Candidate => item !== null);
    return { electricity: await loaded('electricity'), gas: await loaded('gas'), settings };
  }, [session]);

  const electricity =
    data?.electricity.find((item) => item.contract.id === chosenElectricity) ??
    data?.electricity[0];
  // By default, the gas contract billed in the same file as the electricity one (dual invoices).
  const sameFile = (item: Candidate) =>
    electricity?.invoices.some((invoice) =>
      item.invoices.some((gasInvoice) => gasInvoice.fileHash === invoice.fileHash),
    ) ?? false;
  const gas =
    data?.gas.find((item) => item.contract.id === chosenGas) ??
    data?.gas.find(sameFile) ??
    data?.gas[0];

  const date = today();
  const ready = offers && offers !== 'error' ? offers : null;

  const electricityComparison = useMemo(() => {
    if (!electricity?.contract.electricity || !ready || !data) return null;
    const usage = annualUsage(electricity.invoices, electricity.readings, date);
    if (!usage) return null;
    return compareOffers({
      offers: ready.offers,
      latest: {
        lines: electricity.lines,
        periodStart: electricity.latest.periodStart!,
        periodEnd: electricity.latest.periodEnd!,
      },
      usage,
      household: {
        powerKva: electricity.contract.electricity.powerKva,
        largeFamily: data.settings.largeFamily,
      },
      today: date,
    });
  }, [electricity, ready, data, date]);

  const gasUsage = useMemo(
    () => (gas ? annualUsage(gas.invoices, gas.readings, date) : null),
    [gas, date],
  );
  const gasComparison = useMemo(() => {
    const escalao = gas?.contract.gas?.escalao;
    if (!gas || !ready || !gasUsage || !escalao) return null;
    const distributor = gas.contract.gas?.distributor;
    return compareGas({
      offers: ready.offers,
      regulated: ready.regulatedGas,
      latest: {
        lines: gas.lines,
        periodStart: gas.latest.periodStart!,
        periodEnd: gas.latest.periodEnd!,
      },
      usage: gasUsage,
      escalao: String(escalao) as '1' | '2' | '3' | '4',
      ...(distributor ? { distributor } : {}),
      today: date,
    });
  }, [gas, ready, gasUsage, date]);

  const both = useMemo(
    () =>
      electricityComparison && gasComparison
        ? combineElectricityGas(electricityComparison, gasComparison)
        : null,
    [electricityComparison, gasComparison],
  );

  // "Cheaper offer" alert (PLAN.md §9) for electricity, once per ERSE data update.
  useEffect(() => {
    if (!session || !electricity || !electricityComparison || !ready || !data) return;
    const best = electricityComparison.results.find((item) => item.offer.supply === 'ELE');
    void recordCheaperOffer(session.repos, {
      contract: electricity.contract,
      dataDate: ready.dataDate,
      best: best && best.savingCents >= data.settings.cheaperOfferMinSavingCents ? best : undefined,
    });
  }, [session, electricity, electricityComparison, ready, data]);

  if (!session || !data) return null;
  const hasBoth = data.electricity.length > 0 && data.gas.length > 0;
  const shown: Tab = tab === 'both' && !hasBoth ? 'electricity' : tab;

  function choose(next: Tab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Private mode or blocked storage: the tab is simply not remembered.
    }
  }

  async function saveGas(gasDetails: NonNullable<Contract['gas']>) {
    if (!session || !gas) return;
    await session.repos.contracts.put({ ...gas.contract, gas: gasDetails });
  }

  const gasState = gasView({
    hasContract: gas !== undefined,
    hasUsage: gasUsage !== null,
    escalao: gas?.contract.gas?.escalao,
    hasComparison: gasComparison !== null,
  });
  const bothState = bothView({
    hasElectricity: data.electricity.length > 0,
    hasGas: data.gas.length > 0,
    hasBoth: both !== null,
  });

  const missingTaxes =
    gas !== undefined && !gas.lines.some((line) => line.kind === 'tax' && line.amountCents !== 0);

  return (
    <>
      <h1>{copy.title}</h1>
      <p className="muted compare-intro">{copy.intro}</p>
      <div className="compare-tabs" role="tablist" aria-label={copy.title}>
        {(['electricity', 'gas', 'both'] as const)
          .filter((item) => item !== 'both' || hasBoth)
          .map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={shown === item}
              className="compare-tab"
              onClick={() => choose(item)}
            >
              {copy.tabs[item]}
            </button>
          ))}
      </div>
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

      {offers === null && <p role="status">{copy.loading}</p>}
      {offers === 'error' && <p className="ingest-problem">{copy.offersUnavailable}</p>}
      {ready && <p className="muted">{copy.dataDate(formatIsoDate(ready.dataDate))}</p>}

      {shown === 'electricity' && (
        <>
          {data.electricity.length === 0 && <p className="compare-note">{copy.noContract}</p>}
          {data.electricity.length > 1 && (
            <SelectField
              id="compare-contract"
              label={copy.contract}
              value={electricity?.contract.id ?? ''}
              onChange={(event) => setChosenElectricity(event.target.value)}
            >
              {data.electricity.map((item) => (
                <option key={item.contract.id} value={item.contract.id}>
                  {item.contract.label} — {item.provider?.name}
                </option>
              ))}
            </SelectField>
          )}
          {electricityComparison && electricity && (
            <ElectricitySection
              comparison={electricityComparison}
              contract={electricity.contract}
              {...(electricity.provider ? { provider: electricity.provider } : {})}
            />
          )}
        </>
      )}

      {shown === 'gas' && (
        <>
          {gasState === 'noContract' && <p className="compare-note">{copy.gas.noContract}</p>}
          {data.gas.length > 1 && (
            <SelectField
              id="compare-gas-contract"
              label={copy.contract}
              value={gas?.contract.id ?? ''}
              onChange={(event) => setChosenGas(event.target.value)}
            >
              {data.gas.map((item) => (
                <option key={item.contract.id} value={item.contract.id}>
                  {item.contract.label} — {item.provider?.name}
                </option>
              ))}
            </SelectField>
          )}
          {gasState === 'noKwh' && <p className="compare-note">{copy.gas.noKwh}</p>}
          {gas && gasState !== 'noContract' && gasState !== 'noKwh' && (
            <GasSection
              view={gasState}
              comparison={gasComparison}
              contract={gas.contract}
              {...(gas.provider ? { provider: gas.provider } : {})}
              missingTaxes={missingTaxes}
              onChange={(details) => void saveGas(details)}
            />
          )}
        </>
      )}

      {shown === 'both' && both && bothState === 'ready' && <BothSection comparison={both} />}
      {shown === 'both' && bothState !== 'ready' && (
        <p className="compare-note">
          {bothState === 'incomplete' ? copy.both.incomplete : copy.both.needsBoth}
        </p>
      )}

      {ready && <p className="compare-disclaimer">{copy.disclaimer}</p>}
    </>
  );
}
