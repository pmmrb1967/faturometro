import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart, type Bar } from '../../components/BarChart';
import { householdSummary } from '../../domain/household';
import { t } from '../../i18n/pt-PT';
import { formatMonthShort } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';

const copy = t.household;
const euros = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

/** The household's last 12 months and an estimate of the next 12 (Início). */
export function HouseholdSection() {
  const { session } = useSession();
  const summary = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, invoices] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.invoices.list(),
    ]);
    if (invoices.length === 0) return null;
    return householdSummary({ contracts, invoices, today: today() });
  }, [session]);
  if (!summary) return null;

  const bars: Bar[] = summary.months.map(({ month, totalCents }) => {
    const label = formatMonthShort(`${month}-01`);
    return {
      key: month,
      label,
      title: copy.monthTitle(label),
      value: totalCents / 100,
      display: formatCents(totalCents),
    };
  });
  const previous = summary.previousTotalCents;
  const difference = previous === undefined ? 0 : summary.totalCents - previous;

  return (
    <section aria-labelledby="household-title">
      <h2 id="household-title" className="section-title">
        {copy.title}
      </h2>
      <dl className="facts">
        <div>
          <dt>{copy.total}</dt>
          <dd>{formatCents(summary.totalCents)}</dd>
        </div>
        {summary.forecastCents !== null && (
          <div>
            <dt>{copy.forecast}</dt>
            <dd>{formatCents(summary.forecastCents)}</dd>
          </div>
        )}
      </dl>
      {previous !== undefined && (
        <p className="muted">
          {difference === 0 || previous === 0
            ? copy.same
            : copy.previous(
                formatCents(Math.abs(difference)),
                percent.format((Math.abs(difference) / previous) * 100),
                difference > 0,
              )}
        </p>
      )}

      {summary.bySector.length > 1 && (
        <>
          <h3>{copy.bySector}</h3>
          <dl className="facts">
            {summary.bySector.map(({ sector, totalCents }) => (
              <div key={sector}>
                <dt>{t.sectors[sector]}</dt>
                <dd>
                  {copy.share(
                    formatCents(totalCents),
                    percent.format(
                      summary.totalCents > 0 ? (totalCents / summary.totalCents) * 100 : 0,
                    ),
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <BarChart
        title={copy.chart}
        bars={bars}
        formatTick={(value) => `${euros.format(value)} €`}
        tableLabel={t.contracts.charts.table}
        columnLabel={copy.month}
        valueLabel={copy.value}
      />
      <p className="muted">{copy.forecastNote}</p>
    </section>
  );
}
