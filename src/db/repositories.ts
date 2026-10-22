import type {
  AiUsageRecord,
  Alert,
  ConsumptionProfile,
  Contract,
  FieldCorrection,
  Invoice,
  InvoiceLine,
  Provider,
  Payment,
  Reading,
  RecurringExpense,
  Settings,
} from '../domain/types';
import { DocumentStore } from './documents';
import { EncryptedTable } from './encrypted-table';
import type { ProfileDb } from './schema';

export type Repositories = ReturnType<typeof createRepositories>;

/** Indexed (clear) fields must match the indexes in CURRENT_SCHEMA (checked by a test). */
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
    /** Device-local (not in SYNCED_TABLES). */
    aiUsage: new EncryptedTable<AiUsageRecord>(db.aiUsage, key, ['createdAt']),
    alerts: new EncryptedTable<Alert>(db.alerts, key, ['contractId', 'kind']),
    fieldCorrections: new EncryptedTable<FieldCorrection>(db.fieldCorrections, key, ['invoiceId']),
    settings: new EncryptedTable<Settings>(db.settings, key, []),
    expenses: new EncryptedTable<RecurringExpense>(db.expenses, key, []),
    payments: new EncryptedTable<Payment>(db.payments, key, []),
    consumptionProfiles: new EncryptedTable<ConsumptionProfile>(db.consumptionProfiles, key, [
      'supplyPointId',
    ]),
    documents: new DocumentStore(db.documents, key),
  };
}
