import { useLiveQuery } from 'dexie-react-hooks';
import type { Contract, Invoice } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { useSession } from '../auth/session-context';
import { findingText, latestAudit } from './audit-view';

const copy = t.contracts.audit;

/** What changed in the latest invoice (prices, discounts, new charges, contracted price). */
export function AuditSection({ contract, invoices }: { contract: Contract; invoices: Invoice[] }) {
  const { session } = useSession();
  const result = useLiveQuery(
    async () => (session ? latestAudit(session.repos, contract, invoices) : null),
    [session, contract, invoices],
  );
  if (!result) return null;
  const { audit, invoice, previous } = result;
  const compared = Boolean(previous) && audit.detailed;

  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title" className="section-title">
        {copy.title}
      </h2>
      <p className="muted">
        {copy.intro(
          formatIsoDate(invoice.issueDate),
          compared && previous ? formatIsoDate(previous.issueDate) : undefined,
        )}
      </p>
      {audit.findings.length > 0 ? (
        <>
          <ul>
            {audit.findings.map((finding, index) => (
              <li key={index}>{findingText(finding)}</li>
            ))}
          </ul>
          {audit.increased && audit.duringLoyalty && (
            <p className="review-check">{copy.duringLoyalty}</p>
          )}
          {audit.increased && <p className="muted">{copy.letter}</p>}
        </>
      ) : (
        <p>{!audit.detailed ? copy.noDetail : !previous ? copy.onlyOne : copy.nothing}</p>
      )}
    </section>
  );
}
