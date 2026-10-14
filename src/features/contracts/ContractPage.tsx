import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { BarChart, type Bar } from '../../components/BarChart';
import { Field } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate, formatMonthShort } from '../../lib/dates';
import { centsToPtInput, formatCents, parsePtAmount } from '../../lib/money';
import { ContractAssistant } from '../ai/ContractAssistant';
import { refreshAlerts } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { LettersSection } from '../letters/LettersSection';
import { MONTHLY_PRICE_SECTORS } from '../../domain/audit';
import { AuditSection } from './AuditSection';
import { TelecomCompare } from './TelecomCompare';
import '../invoices/invoices.css';

const copy = t.contracts;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

export function ContractPage() {
  const { id = '' } = useParams();
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const contract = await session.repos.contracts.get(id);
    if (!contract) return { contract: undefined };
    const [provider, invoices, readings] = await Promise.all([
      session.repos.providers.get(contract.providerId),
      session.repos.invoices.findBy('contractId', id),
      session.repos.readings.findBy('contractId', id),
    ]);
    invoices.sort((a, b) => a.issueDate.localeCompare(b.issueDate));
    return { contract, provider, invoices, readings };
  }, [session, id]);

  if (!data || !session) return null;
  if (!data.contract) {
    return (
      <>
        <Link to="/app/contratos">← {copy.back}</Link>
        <p className="muted">{copy.notFound}</p>
      </>
    );
  }
  const { contract, provider, invoices = [], readings = [] } = data;

  const costBars: Bar[] = invoices.map((invoice) => ({
    key: invoice.id,
    label: formatMonthShort(invoice.issueDate),
    title: copy.charts.invoiceOf(formatIsoDate(invoice.issueDate)),
    value: invoice.totalCents / 100,
    display: formatCents(invoice.totalCents),
  }));
  const kwhByInvoice = new Map<string, number>();
  for (const reading of readings) {
    if (reading.unit !== 'kWh') continue;
    kwhByInvoice.set(
      reading.invoiceId,
      (kwhByInvoice.get(reading.invoiceId) ?? 0) + reading.quantity,
    );
  }
  const consumptionBars: Bar[] = invoices
    .filter((invoice) => kwhByInvoice.has(invoice.id))
    .map((invoice) => {
      const value = kwhByInvoice.get(invoice.id) ?? 0;
      return {
        key: invoice.id,
        label: formatMonthShort(invoice.issueDate),
        title: copy.charts.invoiceOf(formatIsoDate(invoice.issueDate)),
        value,
        display: `${kwh.format(value)} kWh`,
      };
    });

  const facts: [string, string | undefined][] = [
    [copy.facts.provider, provider?.name],
    [copy.facts.sector, t.sectors[contract.sector]],
    [copy.facts.customerNumber, contract.customerNumber],
    [copy.facts.supplyPoint, contract.supplyPointId],
    [copy.facts.tariff, contract.tariffName],
    [
      copy.facts.power,
      contract.electricity
        ? `${contract.electricity.powerKva.toString().replace('.', ',')} kVA`
        : undefined,
    ],
    [copy.facts.cycle, contract.electricity ? copy.cycles[contract.electricity.cycle] : undefined],
    [copy.facts.socialTariff, contract.electricity?.socialTariff ? copy.facts.yes : undefined],
  ];

  return (
    <>
      <Link to="/app/contratos" className="back-link">
        ← {copy.back}
      </Link>
      <h1>{contract.label}</h1>

      <dl className="facts">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <LoyaltyForm
        key={contract.id}
        initial={contract.loyaltyEndDate ?? ''}
        onSave={async (value) => {
          const next = { ...contract };
          if (value) next.loyaltyEndDate = value;
          else delete next.loyaltyEndDate;
          await session.repos.contracts.put(next);
          await refreshAlerts(session.repos);
        }}
      />

      {MONTHLY_PRICE_SECTORS.includes(contract.sector) && (
        <MonthlyPriceForm
          key={`monthly-${contract.id}`}
          initial={contract.monthlyPriceCents}
          onSave={async (cents) => {
            const next = { ...contract };
            if (cents === undefined) delete next.monthlyPriceCents;
            else next.monthlyPriceCents = cents;
            await session.repos.contracts.put(next);
            await refreshAlerts(session.repos);
          }}
        />
      )}

      <AuditSection contract={contract} invoices={invoices} />

      {contract.sector === 'telecom' && (
        <TelecomCompare
          key={contract.id}
          contract={contract}
          invoices={invoices}
          onSaveServices={async (services) => {
            await session.repos.contracts.put({ ...contract, telecom: { services } });
          }}
        />
      )}

      <BarChart
        title={copy.charts.cost}
        bars={costBars}
        formatTick={(value) => `${euros.format(value)} €`}
        tableLabel={copy.charts.table}
        columnLabel={copy.charts.invoice}
        valueLabel={copy.charts.value}
      />
      {consumptionBars.length > 0 && (
        <BarChart
          title={copy.charts.consumption}
          bars={consumptionBars}
          formatTick={(value) => kwh.format(value)}
          tableLabel={copy.charts.table}
          columnLabel={copy.charts.invoice}
          valueLabel={copy.charts.value}
        />
      )}

      <h2 className="section-title">{copy.invoicesTitle}</h2>
      <ul className="list">
        {[...invoices].reverse().map((invoice) => (
          <li key={invoice.id} className="list-item">
            <strong>{formatIsoDate(invoice.issueDate)}</strong>
            <span className="amount">{formatCents(invoice.totalCents)}</span>
            <span className="meta">
              {invoice.periodStart && invoice.periodEnd
                ? `${formatIsoDate(invoice.periodStart)} – ${formatIsoDate(invoice.periodEnd)}`
                : invoice.docId}
            </span>
          </li>
        ))}
      </ul>

      <LettersSection contract={contract} />
      {invoices.length > 0 && <ContractAssistant contract={contract} />}
    </>
  );
}

function LoyaltyForm({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const loyalty = copy.loyalty;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(value);
    setSaved(true);
  }

  return (
    <form className="loyalty" onSubmit={submit}>
      <Field
        id="loyalty-end"
        label={loyalty.title}
        hint={loyalty.hint}
        type="date"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
      />
      <div className="ingest-actions">
        <button type="submit" className="action-primary">
          {loyalty.save}
        </button>
        {initial && (
          <button
            type="button"
            className="action-secondary"
            onClick={() => {
              setValue('');
              void onSave('').then(() => setSaved(true));
            }}
          >
            {loyalty.clear}
          </button>
        )}
      </div>
      {saved && (
        <p role="status" className="doc-saved">
          {loyalty.saved}
        </p>
      )}
    </form>
  );
}

function MonthlyPriceForm({
  initial,
  onSave,
}: {
  initial: number | undefined;
  onSave: (cents: number | undefined) => Promise<void>;
}) {
  const [value, setValue] = useState(initial === undefined ? '' : centsToPtInput(initial));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const monthly = copy.monthlyPrice;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = value.trim() ? parsePtAmount(value) : undefined;
    if (cents === null || (cents !== undefined && cents <= 0)) {
      setError(monthly.invalid);
      return;
    }
    setError(undefined);
    await onSave(cents);
    setSaved(true);
  }

  return (
    <form className="loyalty" onSubmit={submit} noValidate>
      <Field
        id="monthly-price"
        label={monthly.title}
        hint={monthly.hint}
        inputMode="decimal"
        value={value}
        {...(error ? { error } : {})}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
      />
      <div className="ingest-actions">
        <button type="submit" className="action-primary">
          {monthly.save}
        </button>
        {initial !== undefined && (
          <button
            type="button"
            className="action-secondary"
            onClick={() => {
              setValue('');
              setError(undefined);
              void onSave(undefined).then(() => setSaved(true));
            }}
          >
            {monthly.clear}
          </button>
        )}
      </div>
      {saved && (
        <p role="status" className="doc-saved">
          {monthly.saved}
        </p>
      )}
    </form>
  );
}
