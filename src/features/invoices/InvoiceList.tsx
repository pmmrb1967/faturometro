import { useLiveQuery } from 'dexie-react-hooks';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { useSession } from '../auth/session-context';
import './invoices.css';

export function InvoiceList() {
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [invoices, providers, contracts] = await Promise.all([
      session.repos.invoices.list(),
      session.repos.providers.list(),
      session.repos.contracts.list(),
    ]);
    return {
      invoices: invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
      providers: new Map(providers.map((provider) => [provider.id, provider])),
      contracts: new Map(contracts.map((contract) => [contract.id, contract])),
    };
  }, [session]);

  if (!data) return null;

  return (
    <section aria-labelledby="invoice-list-title">
      <h2 id="invoice-list-title" className="section-title">
        {t.invoices.listTitle}
      </h2>
      {data.invoices.length === 0 ? (
        <p className="muted">{t.invoices.empty}</p>
      ) : (
        <ul className="list">
          {data.invoices.map((invoice) => (
            <li key={invoice.id} className="list-item">
              <strong>{data.providers.get(invoice.providerId)?.name}</strong>
              <span className="amount">{formatCents(invoice.totalCents)}</span>
              <span className="meta">
                {formatIsoDate(invoice.issueDate)} · {data.contracts.get(invoice.contractId)?.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
