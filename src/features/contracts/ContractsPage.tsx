import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { useSession } from '../auth/session-context';
import '../invoices/invoices.css';

export function ContractsPage() {
  const { session } = useSession();
  const rows = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, providers, invoices] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.providers.list(),
      session.repos.invoices.list(),
    ]);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    return contracts
      .map((contract) => {
        const own = invoices
          .filter((invoice) => invoice.contractId === contract.id)
          .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
        return {
          contract,
          provider: providerById.get(contract.providerId),
          count: own.length,
          last: own[0],
        };
      })
      .sort((a, b) => (b.last?.issueDate ?? '').localeCompare(a.last?.issueDate ?? ''));
  }, [session]);

  return (
    <>
      <h1>{t.nav.contracts}</h1>
      {rows?.length === 0 && <p className="muted">{t.contracts.empty}</p>}
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map(({ contract, provider, count, last }) => (
            <li key={contract.id} className="list-item">
              <Link to={`/app/contratos/${contract.id}`} className="list-link">
                {contract.label} — {provider?.name}
              </Link>
              <span className="amount">{last ? formatCents(last.totalCents) : '—'}</span>
              <span className="meta">
                {t.sectors[contract.sector]} · {t.contracts.invoiceCount(count)}
                {last && ` · ${t.contracts.lastInvoice} ${formatIsoDate(last.issueDate)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
