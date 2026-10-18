import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { ProposalsSection } from './ProposalsSection';
import './insurance.css';

const copy = t.insurance.section;

/** A table cell; empty ones are hidden on phones (one card per coverage). */
function Cell({
  label,
  value,
  amount = false,
}: {
  label: string;
  value: string | undefined;
  amount?: boolean;
}) {
  const classes = [value ? '' : 'is-empty', amount ? 'is-amount' : ''].filter(Boolean).join(' ');
  return (
    <td data-label={label} className={classes || undefined}>
      {value ?? '—'}
    </td>
  );
}
const pct = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1, signDisplay: 'always' });

/** What the renewal letter and the particular conditions said about the policy. */
export function InsuranceSection({ contract }: { contract: Contract }) {
  const insurance = contract.insurance;
  const renewal = insurance?.renewal;
  const coverages = insurance?.coverages ?? [];
  if (contract.sector !== 'insurance' || (!renewal && coverages.length === 0)) return null;
  // Health policies: share in the network and by reimbursement, and waiting periods.
  const health = coverages.some(
    (coverage) => coverage.network || coverage.reimbursement || coverage.waitingPeriod,
  );

  return (
    <>
      {renewal && (
        <section aria-labelledby="insurance-renewal-title">
          <h2 id="insurance-renewal-title" className="section-title">
            {copy.renewalTitle(formatIsoDate(renewal.date))}
          </h2>
          <p>
            <strong>
              {copy.premium(
                formatCents(renewal.currentCents),
                formatCents(renewal.nextCents),
                pct.format(
                  renewal.currentCents > 0
                    ? ((renewal.nextCents - renewal.currentCents) / renewal.currentCents) * 100
                    : 0,
                ),
              )}
            </strong>
          </p>
          {renewal.factors && renewal.factors.length > 0 && (
            <>
              <p className="muted">{copy.factors}</p>
              <ul>
                {renewal.factors.map((factor) => (
                  <li key={factor.name}>
                    {factor.name}: {pct.format(factor.pct)} %
                  </li>
                ))}
              </ul>
            </>
          )}
          {renewal.capitals?.map((capital) => (
            <p key={capital.name} className="muted">
              {capital.name}: {formatCents(capital.currentCents)} → {formatCents(capital.nextCents)}
            </p>
          ))}
        </section>
      )}

      {coverages.length > 0 && (
        <section aria-labelledby="insurance-coverages-title">
          <h2 id="insurance-coverages-title" className="section-title">
            {copy.coveragesTitle}
          </h2>
          <div className="coverage-scroll">
            <table className="coverage-table">
              <thead>
                <tr>
                  <th scope="col">{copy.coverage}</th>
                  <th scope="col">{copy.capital}</th>
                  {health && <th scope="col">{copy.network}</th>}
                  {health && <th scope="col">{copy.reimbursement}</th>}
                  <th scope="col">{copy.deductible}</th>
                  {health && <th scope="col">{copy.waiting}</th>}
                </tr>
              </thead>
              <tbody>
                {coverages.map((coverage) => (
                  <tr key={coverage.name}>
                    <th scope="row">{coverage.name}</th>
                    <Cell label={copy.capital} value={coverage.capital} amount />
                    {health && <Cell label={copy.network} value={coverage.network} />}
                    {health && <Cell label={copy.reimbursement} value={coverage.reimbursement} />}
                    <Cell label={copy.deductible} value={coverage.deductible} />
                    {health && <Cell label={copy.waiting} value={coverage.waitingPeriod} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">{copy.coveragesNote}</p>
        </section>
      )}
      <ProposalsSection contract={contract} />
    </>
  );
}
