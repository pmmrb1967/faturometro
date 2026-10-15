/**
 * "Ler de novo com o novo leitor": an invoice saved before its supplier had a
 * reader (or with an older version) is read again from its stored original.
 * The QR code data (total, VAT, date, number) stays; lines, readings, period
 * and contract details are replaced by what the reader finds.
 */
import type { Repositories } from '../../db/repositories';
import type { Invoice, Provider } from '../../domain/types';
import { PARSERS } from '../../parsers/registry';
import type { Parser } from '../../parsers/types';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { readPdfWithPasswords, runParser, type IngestDeps } from '../ingest/ingest';
import { refreshAlerts } from '../alerts/refresh';
import { getSettings } from '../settings/settings';
import { contractDetails } from './form';
import { storeLinesAndReadings, updateContractDetails } from './save';

/** The reader that would read this invoice now, if it is newer than what read it. */
export function newerReader(
  invoice: Pick<Invoice, 'parserId' | 'parserVersion'>,
  provider: Pick<Provider, 'nif'> | undefined,
): Parser | undefined {
  if (!provider) return undefined;
  const parser = PARSERS.find((candidate) => candidate.issuerNifs.includes(provider.nif));
  if (!parser) return undefined;
  const same = invoice.parserId === parser.id && invoice.parserVersion === parser.version;
  return same ? undefined : parser;
}

export type ReparseResult = 'updated' | 'no_original' | 'unreadable' | 'not_found';

function sameDocument(qr: FiscalQr, invoice: Invoice, provider: Provider): boolean {
  if (qr.issuerNif !== provider.nif) return false;
  if (invoice.docId && qr.docId)
    return qr.docId.replace(/\s+/g, '') === invoice.docId.replace(/\s+/g, '');
  return qr.totalCents === invoice.totalCents && qr.date === invoice.issueDate;
}

export async function reparseInvoice(
  repos: Repositories,
  invoice: Invoice,
  deps: Pick<IngestDeps, 'readPdf'>,
): Promise<ReparseResult> {
  const [original, provider, contract, settings] = await Promise.all([
    repos.documents.getByFileHash(invoice.fileHash),
    repos.providers.get(invoice.providerId),
    repos.contracts.get(invoice.contractId),
    getSettings(repos),
  ]);
  if (!original || !provider || !contract) return 'no_original';
  if (original.mime !== 'application/pdf') return 'unreadable';

  const passwords = settings.ownNif ? [settings.ownNif] : [];
  const read = await readPdfWithPasswords(original.bytes, passwords, {
    ...deps,
    findInvoiceIdByFileHash: async () => undefined,
    findInvoiceIdByDocKey: async () => undefined,
    readImage: async () => [],
  });
  if (!read.ok) return 'unreadable';
  const qrs = read.qrs.flatMap((found) => {
    const result = parseFiscalQr(found.text);
    return result.ok ? [result.qr] : [];
  });
  const qr = qrs.find((candidate) => sameDocument(candidate, invoice, provider));
  const parsed = runParser(read.pages, qrs, qr);
  if (!parsed) return 'not_found';
  const { extraction } = parsed;

  // Old lines and readings go; the reader's take their place.
  for (const line of await repos.invoiceLines.findBy('invoiceId', invoice.id)) {
    await repos.invoiceLines.remove(line.id);
  }
  for (const reading of await repos.readings.findBy('invoiceId', invoice.id)) {
    await repos.readings.remove(reading.id);
  }
  const updated: Invoice = {
    ...invoice,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    validation: qr ? parsed.check.validation : 'not_checked',
    confidence: { ...invoice.confidence, ...parsed.check.confidence },
  };
  if (extraction.periodStart) updated.periodStart = extraction.periodStart.value;
  if (extraction.periodEnd) updated.periodEnd = extraction.periodEnd.value;
  if (extraction.dueDate) updated.dueDate = extraction.dueDate.value;
  for (const field of ['periodStart', 'periodEnd', 'dueDate'] as const) {
    if (extraction[field]) updated.sources = { ...updated.sources, [field]: 'parser' };
  }
  const saved = await repos.invoices.put(updated);
  await storeLinesAndReadings(repos, saved, extraction.lines, extraction.readings);
  await updateContractDetails(
    repos,
    contract,
    contractDetails(extraction, contract.sector),
    invoice.issueDate,
  );
  await refreshAlerts(repos);
  return 'updated';
}
