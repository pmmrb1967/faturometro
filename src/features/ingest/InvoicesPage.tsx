import { t } from '../../i18n/pt-PT';
import { InvoiceList } from '../invoices/InvoiceList';
import { AddInvoice } from './AddInvoice';

export function InvoicesPage() {
  return (
    <>
      <h1>{t.nav.invoices}</h1>
      <AddInvoice />
      <InvoiceList />
    </>
  );
}
