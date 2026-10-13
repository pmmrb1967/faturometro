import type {
  Alert,
  Contract,
  FieldCorrection,
  Invoice,
  InvoiceLine,
  Provider,
  Reading,
  Settings,
} from '../domain/types';
import { EncryptedTable } from './encrypted-table';
import type { ProfileDb } from './schema';

export type Repositories = ReturnType<typeof createRepositories>;

/** Indexed (clear) fields must match the indexes in SCHEMA_V1 (checked by a test). */
export function createRepositories(db: ProfileDb, key: CryptoKey) {
  return {
    providers: new EncryptedTable<Provider>(db.providers, key, ['nif']),
    contracts: new EncryptedTable<Contract>(db.contracts, key, ['providerId', 'sector']),
    invoices: new EncryptedTable<Invoice>(db.invoices, key, [
      'contractId',
      'providerId',
      'fileHash',
      'docKey',
      'issueDate',
    ]),
    invoiceLines: new EncryptedTable<InvoiceLine>(db.invoiceLines, key, ['invoiceId']),
    readings: new EncryptedTable<Reading>(db.readings, key, ['invoiceId', 'contractId', 'dateTo']),
    alerts: new EncryptedTable<Alert>(db.alerts, key, ['contractId', 'kind']),
    fieldCorrections: new EncryptedTable<FieldCorrection>(db.fieldCorrections, key, ['invoiceId']),
    settings: new EncryptedTable<Settings>(db.settings, key, []),
  };
}
