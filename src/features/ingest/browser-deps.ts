import type { Repositories } from '../../db/repositories';
import type { IngestDeps } from './ingest';

/** pdf.js and zxing are loaded only when a file is added, keeping the first load small. */
export function browserIngestDeps(repos: Repositories): IngestDeps {
  return {
    findInvoiceIdByFileHash: async (fileHash) =>
      (await repos.invoices.findBy('fileHash', fileHash))[0]?.id,
    findInvoiceIdByDocKey: async (docKey) => (await repos.invoices.findBy('docKey', docKey))[0]?.id,
    readPdf: async (bytes, password) =>
      (await import('../../pdf/browser')).readPdf(bytes, password),
    readImage: async (bytes, mime) => (await import('../../pdf/browser')).readImage(bytes, mime),
  };
}
