import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import './insurance.css';

const copy = t.insurance.section;
const pct = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1, signDisplay: 'always' });

/** What the renewal letter and the particular conditions said about the policy. */
export function InsuranceSection({ contract }: { contract: Contract }) {
  const insurance = contract.insurance;
  const renewal = insurance?.renewal;
  const coverages = insurance?.coverages ?? [];
  if (contract.sector !== 'insurance' || (!renewal && coverages.length === 0)) return null;

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
                  <th scope="col">{copy.deductible}</th>
                </tr>
              </thead>
              <tbody>
                {coverages.map((coverage) => (
                  <tr key={coverage.name}>
                    <th scope="row">{coverage.name}</th>
                    <td>{coverage.capital ?? '—'}</td>
                    <td>{coverage.deductible ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">{copy.coveragesNote}</p>
        </section>
      )}
    </>
  );
}
