import { useLiveQuery } from 'dexie-react-hooks';
import { GroupBlock, GroupControls, LimitedList } from '../../components/GroupBlock';
import { useOpenGroups } from '../../components/group-state';
import { billingFrequency, byGroup } from '../../domain/grouping';
import { linesByInvoiceId, socialDiscountCents } from '../../domain/social-tariff';
import type { Invoice } from '../../domain/types';
import { today } from '../alerts/refresh';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { useSession } from '../auth/session-context';
import { ContributeFromOriginal } from '../contribute/ContributeFromOriginal';
import { shouldOffer } from '../contribute/eligible';
import { OriginalButton } from './OriginalButton';
import { ReparseButton } from './ReparseButton';
import { newerReader } from './reparse';
import './invoices.css';

/** Per-device choice: which blocks of the list are open. */
const OPEN_GROUPS_KEY = 'faturometro.invoices.openGroups';

export function InvoiceList() {
  const { session } = useSession();
  const groupsOpen = useOpenGroups(OPEN_GROUPS_KEY);
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [invoices, providers, contracts, lines] = await Promise.all([
      session.repos.invoices.list(),
      session.repos.providers.list(),
      session.repos.contracts.list(),
      session.repos.invoiceLines.list(),
    ]);
    const socialDiscounts = new Map(
      [...linesByInvoiceId(lines)].map(([invoiceId, own]) => [invoiceId, socialDiscountCents(own)]),
    );
    const originals = new Map(
      await Promise.all(
        [...new Set(invoices.map((invoice) => invoice.fileHash))].map(
          async (fileHash) => [fileHash, await session.repos.documents.stateOf(fileHash)] as const,
        ),
      ),
    );
    return {
      originals,
      socialDiscounts,
      invoices: invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
      providers: new Map(providers.map((provider) => [provider.id, provider])),
      contracts: new Map(contracts.map((contract) => [contract.id, contract])),
    };
  }, [session]);

  if (!data) return null;
  const yearAgo = `${Number(today().slice(0, 4)) - 1}${today().slice(4)}`;
  const groups = byGroup(
    data.invoices,
    (invoice) => data.contracts.get(invoice.contractId)?.sector ?? 'other',
  );

  const row = (invoice: Invoice) => {
    const frequency = billingFrequency(invoice.periodStart, invoice.periodEnd);
    // A reader that did not read this invoice yet, and the original is on this device.
    const reader = ['local', 'uploaded'].includes(data.originals.get(invoice.fileHash) ?? '')
      ? newerReader(invoice, data.providers.get(invoice.providerId))
      : undefined;
    return (
      <li key={invoice.id} className="list-item">
        <strong>{data.providers.get(invoice.providerId)?.name}</strong>
        <span className="amount">{formatCents(invoice.totalCents)}</span>
        <span className="meta">
          {formatIsoDate(invoice.issueDate)} · {data.contracts.get(invoice.contractId)?.label}
          {frequency && ` · ${t.frequency[frequency]}`}
        </span>
        {(data.socialDiscounts.get(invoice.id) ?? 0) > 0 && (
          <span className="list-badge">
            {t.invoices.socialDiscount(formatCents(data.socialDiscounts.get(invoice.id)!))}
          </span>
        )}
        {data.originals.get(invoice.fileHash) && (
          <OriginalButton
            fileHash={invoice.fileHash}
            state={data.originals.get(invoice.fileHash)!}
          />
        )}
        {['local', 'uploaded'].includes(data.originals.get(invoice.fileHash) ?? '') &&
          shouldOffer({
            fileKind: 'pdf',
            hasText: true,
            ...(invoice.parserId ? { parserId: invoice.parserId } : {}),
            validation: invoice.validation,
          }) &&
          !reader && <ContributeFromOriginal fileHash={invoice.fileHash} />}
        {reader && <ReparseButton invoice={invoice} parser={reader} />}
      </li>
    );
  };

  return (
    <section aria-labelledby="invoice-list-title">
      <h2 id="invoice-list-title" className="section-title">
        {t.invoices.listTitle}
      </h2>
      {data.invoices.length === 0 ? (
        <p className="muted">{t.invoices.empty}</p>
      ) : (
        <>
          {groups.length > 1 && (
            <GroupControls
              onAll={(open) =>
                groupsOpen.setAll(
                  groups.map(({ group }) => group),
                  open,
                )
              }
            />
          )}
          {groups.map(({ group, items }) => (
            <GroupBlock
              key={group}
              title={t.groups[group]}
              open={groupsOpen.isOpen(group)}
              onToggle={(open) => groupsOpen.setOpen(group, open)}
              summary={t.groups.invoices(
                items.length,
                formatCents(
                  items
                    .filter((invoice) => invoice.issueDate >= yearAgo)
                    .reduce((sum, invoice) => sum + invoice.totalCents, 0),
                ),
              )}
            >
              <LimitedList items={items} render={row} />
            </GroupBlock>
          ))}
        </>
      )}
    </section>
  );
}
