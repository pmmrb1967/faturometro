import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { SelectField } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import type { PolicyDocument } from '../../parsers/policy-documents';
import { refreshAlerts } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { contractForDocument, withPolicyDocument } from './policy-document';

const copy = t.insurance.document;
const pct = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1, signDisplay: 'always' });

/** A renewal letter or particular conditions: shown, then saved into the policy's contract. */
export function PolicyDocumentCard({ document }: { document: PolicyDocument }) {
  const { session } = useSession();
  const contracts = useLiveQuery(
    async () =>
      session
        ? (await session.repos.contracts.list()).filter(
            (contract) => contract.sector === 'insurance',
          )
        : [],
    [session],
  );
  const [choice, setChoice] = useState<string>();
  const [saved, setSaved] = useState<string>();
  if (!session || !contracts) return null;
  const contractId = choice ?? contractForDocument(contracts, document);

  async function save() {
    const contract = contracts?.find((candidate) => candidate.id === contractId);
    if (!session || !contract) return;
    await session.repos.contracts.put({
      ...contract,
      insurance: withPolicyDocument(contract.insurance, document),
    });
    await refreshAlerts(session.repos);
    setSaved(contract.label);
  }

  const heading = [
    document.kind === 'renewal'
      ? copy.renewalTitle
      : document.source === 'proposal'
        ? copy.proposalTitle
        : copy.conditionsTitle,
    document.title,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="doc-card policy-document">
      <h3>{heading}</h3>
      <p className="muted">{copy.notInvoice(document.issuerName)}</p>
      {document.kind === 'renewal' ? (
        <>
          <p>
            <strong>
              {copy.renewal(
                formatIsoDate(document.renewal.date),
                formatCents(document.renewal.currentCents),
                formatCents(document.renewal.nextCents),
                pct.format(
                  document.renewal.currentCents > 0
                    ? ((document.renewal.nextCents - document.renewal.currentCents) /
                        document.renewal.currentCents) *
                        100
                    : 0,
                ),
              )}
            </strong>
          </p>
          {document.renewal.factors && (
            <ul>
              {document.renewal.factors.map((factor) => (
                <li key={factor.name}>{copy.factor(factor.name, pct.format(factor.pct))}</li>
              ))}
            </ul>
          )}
          {document.renewal.capitals?.map((capital) => (
            <p key={capital.name} className="muted">
              {copy.capital(
                capital.name,
                formatCents(capital.currentCents),
                formatCents(capital.nextCents),
              )}
            </p>
          ))}
        </>
      ) : (
        <p>
          {copy.conditions(
            document.details.coverages?.length ?? 0,
            document.details.annualPremiumCents !== undefined
              ? formatCents(document.details.annualPremiumCents)
              : undefined,
          )}
        </p>
      )}

      {saved ? (
        <p role="status" className="doc-saved">
          {copy.saved(saved)}
        </p>
      ) : contracts.length === 0 ? (
        <p className="ingest-problem">{copy.noContract}</p>
      ) : (
        <>
          <SelectField
            id="policy-contract"
            label={copy.contract}
            value={contractId}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">{copy.choose}</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {[contract.label, contract.insurance?.insuredObject].filter(Boolean).join(' · ')}
              </option>
            ))}
          </SelectField>
          <div className="ingest-actions">
            <button
              type="button"
              className="action-primary"
              disabled={!contractId}
              onClick={() => void save()}
            >
              {copy.save}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
