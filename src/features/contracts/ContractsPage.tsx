import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { GroupBlock } from '../../components/GroupBlock';
import { byGroup } from '../../domain/grouping';
import { linesByInvoiceId, socialTariffState } from '../../domain/social-tariff';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import type { Invoice } from '../../domain/types';
import { formatCents } from '../../lib/money';
import { useSession } from '../auth/session-context';
import { CalendarExport } from './CalendarExport';
import '../invoices/invoices.css';

export function ContractsPage() {
  const { session } = useSession();
  const rows = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, providers, invoices, lines] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.providers.list(),
      session.repos.invoices.list(),
      session.repos.invoiceLines.list(),
    ]);
    const linesByInvoice = linesByInvoiceId(lines);
    const linesOf = (invoice: Invoice) => linesByInvoice.get(invoice.id) ?? [];
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    return (
      contracts
        .map((contract) => {
          const own = invoices
            .filter((invoice) => invoice.contractId === contract.id)
            .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
          return {
            contract,
            provider: providerById.get(contract.providerId),
            count: own.length,
            last: own[0],
            social: socialTariffState(contract, own, linesOf)?.state,
          };
        })
        // Active contracts first, then by latest invoice.
        .sort(
          (a, b) =>
            Number(b.contract.active) - Number(a.contract.active) ||
            (b.last?.issueDate ?? '').localeCompare(a.last?.issueDate ?? ''),
        )
    );
  }, [session]);

  return (
    <>
      <h1>{t.nav.contracts}</h1>
      {rows?.length === 0 && <p className="muted">{t.contracts.empty}</p>}
      {rows &&
        byGroup(rows, (row) => row.contract.sector).map(({ group, items }) => (
          <GroupBlock
            key={group}
            title={t.groups[group]}
            summary={t.groups.contracts(items.length)}
          >
            <ul className="list">
              {items.map(({ contract, provider, count, last, social }) => (
                <li key={contract.id} className="list-item">
                  <Link to={`/app/contratos/${contract.id}`} className="list-link">
                    {contract.label} — {provider?.name}
                  </Link>
                  <span className="amount">{last ? formatCents(last.totalCents) : '—'}</span>
                  <span className="meta">
                    {t.sectors[contract.sector]} · {t.contracts.invoiceCount(count)}
                    {contract.endedAt &&
                      ` · ${t.contracts.switch.listEnded(formatIsoDate(contract.endedAt))}`}
                    {last && ` · ${t.contracts.lastInvoice} ${formatIsoDate(last.issueDate)}`}
                  </span>
                  {social && (
                    <span className={`list-badge${social === 'lost' ? ' is-warning' : ''}`}>
                      {social === 'active' ? t.contracts.socialBadge : t.contracts.socialLostBadge}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </GroupBlock>
        ))}
      {rows && rows.length > 0 && <CalendarExport />}
    </>
  );
}
