import { useState } from 'react';
import { Link } from 'react-router';
import { GroupBlock } from '../../components/GroupBlock';
import { warrantyStatus } from '../../domain/warranty';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { today } from '../alerts/refresh';
import { OriginalButton } from '../invoices/OriginalButton';
import { useWarranties } from './use-warranties';

const copy = t.warranties;

/** On "Faturas": the invoices and receipts kept with the warranties, to open them. */
export function WarrantyDocuments() {
  const data = useWarranties();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const withDocument = data.warranties.filter((warranty) => {
    const state = warranty.fileHash ? data.states.get(warranty.fileHash) : undefined;
    return state !== undefined && state !== 'gone';
  });
  if (withDocument.length === 0) return null;
  const date = today();

  return (
    <section aria-label={copy.documents.title}>
      <GroupBlock
        title={copy.documents.title}
        summary={copy.documents.summary(withDocument.length)}
        open={open}
        onToggle={setOpen}
      >
        <p className="muted">
          {copy.documents.intro}{' '}
          <Link to="/app/contratos?separador=garantias">{copy.documents.link}</Link>
        </p>
        <ul className="list">
          {withDocument.map((warranty) => {
            const status = warrantyStatus(warranty, date);
            const end = formatIsoDate(status.endDate);
            return (
              <li key={warranty.id} className="list-item">
                <strong>{warranty.product}</strong>
                <span className="meta">
                  {[
                    warranty.seller,
                    formatIsoDate(warranty.purchaseDate),
                    status.state === 'ended' ? copy.endedOn(end) : copy.until(end),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <OriginalButton
                  fileHash={warranty.fileHash!}
                  state={data.states.get(warranty.fileHash!)!}
                />
              </li>
            );
          })}
        </ul>
      </GroupBlock>
    </section>
  );
}
