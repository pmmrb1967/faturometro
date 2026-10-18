import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import {
  compareProposal,
  coverageSummary,
  type CoverageComparison,
} from '../../domain/insurance-proposals';
import type { Contract, InsuranceProposal, ProposalCoverage } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents, parsePtAmount, type Cents } from '../../lib/money';
import { useSession } from '../auth/session-context';

const copy = t.insurance.proposals;

interface CoverageDraft {
  included: boolean;
  capital: string;
  deductible: string;
}

/** Empty → undefined; not an amount → null. */
function amountOf(text: string): Cents | undefined | null {
  if (!text.trim()) return undefined;
  const cents = parsePtAmount(text);
  return cents !== null && cents >= 0 ? cents : null;
}

function proposedText(comparison: CoverageComparison): string {
  const proposed = comparison.proposed;
  if (!proposed?.included) return '—';
  const parts = [
    proposed.capitalCents !== undefined && formatCents(proposed.capitalCents),
    proposed.deductibleCents !== undefined &&
      `${t.insurance.section.deductible}: ${formatCents(proposed.deductibleCents)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : copy.verdicts.ok!;
}

function currentText(comparison: CoverageComparison): string {
  const { capital, deductible } = comparison.current;
  return [capital, deductible && `${t.insurance.section.deductible}: ${deductible}`]
    .filter(Boolean)
    .join(' · ');
}

function ProposalForm({
  contract,
  onDone,
}: {
  contract: Contract;
  onDone: (proposal: InsuranceProposal | null) => Promise<void>;
}) {
  const names = (contract.insurance?.coverages ?? []).map((coverage) => coverage.name);
  const [insurer, setInsurer] = useState('');
  const [premium, setPremium] = useState('');
  const [rows, setRows] = useState<CoverageDraft[]>(
    names.map(() => ({ included: true, capital: '', deductible: '' })),
  );
  const [submitted, setSubmitted] = useState(false);

  const premiumCents = amountOf(premium);
  const parsed = rows.map((row) => ({
    capital: amountOf(row.capital),
    deductible: amountOf(row.deductible),
  }));
  const invalid =
    !insurer.trim() ||
    typeof premiumCents !== 'number' ||
    parsed.some((row) => row.capital === null || row.deductible === null);

  const update = (index: number, change: Partial<CoverageDraft>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (invalid || typeof premiumCents !== 'number') return;
    const coverages = names.map((name, index): ProposalCoverage => {
      const row = rows[index]!;
      const { capital, deductible } = parsed[index]!;
      return {
        name,
        included: row.included,
        ...(row.included && typeof capital === 'number' ? { capitalCents: capital } : {}),
        ...(row.included && typeof deductible === 'number' ? { deductibleCents: deductible } : {}),
      };
    });
    await onDone({
      id: crypto.randomUUID(),
      insurer: insurer.trim(),
      annualPremiumCents: premiumCents,
      coverages,
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <form className="proposal-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        id="proposal-insurer"
        label={copy.insurer}
        value={insurer}
        onChange={(event) => setInsurer(event.target.value)}
        {...(submitted && !insurer.trim() ? { error: copy.errors.insurer } : {})}
      />
      <Field
        id="proposal-premium"
        label={copy.premium}
        inputMode="decimal"
        value={premium}
        onChange={(event) => setPremium(event.target.value)}
        {...(submitted && typeof premiumCents !== 'number' ? { error: copy.errors.amount } : {})}
      />
      <ul className="proposal-coverages">
        {names.map((name, index) => {
          const row = rows[index]!;
          return (
            <li key={name}>
              <label className="proposal-check">
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={(event) => update(index, { included: event.target.checked })}
                />
                <span>
                  <strong>{name}</strong> · {copy.included}
                </span>
              </label>
              {row.included && (
                <div className="proposal-amounts">
                  <Field
                    id={`proposal-capital-${index}`}
                    label={copy.capital}
                    inputMode="decimal"
                    value={row.capital}
                    onChange={(event) => update(index, { capital: event.target.value })}
                    {...(parsed[index]!.capital === null ? { error: copy.errors.amount } : {})}
                  />
                  <Field
                    id={`proposal-deductible-${index}`}
                    label={copy.deductible}
                    inputMode="decimal"
                    value={row.deductible}
                    onChange={(event) => update(index, { deductible: event.target.value })}
                    {...(parsed[index]!.deductible === null ? { error: copy.errors.amount } : {})}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="proposal-actions">
        <button type="submit" className="action-primary">
          {copy.save}
        </button>
        <button type="button" className="action-secondary" onClick={() => void onDone(null)}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}

/** Insurance contract with coverages: proposals from other insurers, and a summary to copy. */
export function ProposalsSection({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const insurance = contract.insurance;
  if (!session || !insurance?.coverages?.length) return null;
  const proposals = insurance.proposals ?? [];

  async function saveProposals(next: InsuranceProposal[]) {
    if (!session) return;
    await session.repos.contracts.put({
      ...contract,
      insurance: { ...contract.insurance, proposals: next },
    });
  }

  async function copySummary() {
    if (!insurance) return;
    const text = coverageSummary(
      insurance,
      {
        capital: t.insurance.section.capital,
        deductible: t.insurance.section.deductible,
        premium: copy.summaryPremium,
      },
      formatCents,
    );
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <section aria-labelledby="insurance-proposals-title">
      <h2 id="insurance-proposals-title" className="section-title">
        {copy.title}
      </h2>
      <p className="muted">{copy.intro}</p>
      <p>
        <button type="button" className="action-secondary" onClick={() => void copySummary()}>
          {copy.summary}
        </button>
      </p>
      <p className="field-hint" role="status">
        {copied ? copy.copied : copy.summaryHint}
      </p>

      {proposals.map((proposal) => {
        const comparison = compareProposal(insurance, proposal);
        const difference = comparison.premiumDifferenceCents;
        return (
          <article key={proposal.id} className="proposal">
            <h3>{copy.header(proposal.insurer, formatCents(proposal.annualPremiumCents))}</h3>
            {difference !== undefined && (
              <p className={difference < 0 ? 'proposal-cheaper' : undefined}>
                {difference < 0
                  ? copy.cheaper(formatCents(-difference))
                  : difference > 0
                    ? copy.dearer(formatCents(difference))
                    : copy.samePrice}
              </p>
            )}
            <p>{copy.worse(comparison.worse)}</p>
            <div className="coverage-scroll">
              <table className="coverage-table">
                <thead>
                  <tr>
                    <th scope="col">{t.insurance.section.coverage}</th>
                    <th scope="col">{copy.current}</th>
                    <th scope="col">{copy.proposed}</th>
                    <th scope="col">{copy.result}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.coverages.map((coverage) => (
                    <tr key={coverage.name}>
                      <th scope="row">{coverage.name}</th>
                      <td data-label={copy.current}>{currentText(coverage) || '—'}</td>
                      <td data-label={copy.proposed}>{proposedText(coverage)}</td>
                      <td
                        data-label={copy.result}
                        className={
                          coverage.verdicts.includes('ok') ? 'proposal-ok' : 'proposal-worse'
                        }
                      >
                        {coverage.verdicts.map((verdict) => copy.verdicts[verdict]).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="action-secondary danger"
              onClick={() =>
                void saveProposals(proposals.filter((other) => other.id !== proposal.id))
              }
            >
              {copy.remove}
            </button>
          </article>
        );
      })}

      {adding ? (
        <ProposalForm
          contract={contract}
          onDone={async (proposal) => {
            if (proposal) await saveProposals([...proposals, proposal]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="action-primary" onClick={() => setAdding(true)}>
          {copy.add}
        </button>
      )}
      <p className="muted">{copy.note}</p>
    </section>
  );
}
