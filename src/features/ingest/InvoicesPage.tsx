import { t } from '../../i18n/pt-PT';
import { AddInvoice } from './AddInvoice';

export function InvoicesPage() {
  return (
    <>
      <h1>{t.nav.invoices}</h1>
      <AddInvoice />
    </>
  );
}
