/**
 * Ingestion pipeline, steps 0–2 (PLAN.md section 6): file → hash and
 * deduplication → PDF password → text and every fiscal QR code.
 * PDF/image reading is injected, so this module has no browser dependencies.
 */
import { sha256Hex } from '../../lib/crypto';
import { PdfPasswordError, type PageText, type PasswordProblem } from '../../pdf/text';
import { parseFiscalQr, type QrParseResult } from '../../qr/parse';
import type { FoundQr } from '../../qr/scan';

export interface IngestDeps {
  findInvoiceIdByFileHash(fileHash: string): Promise<string | undefined>;
  findInvoiceIdByDocKey(docKey: string): Promise<string | undefined>;
  /** Throws PdfPasswordError when the password is missing or wrong. */
  readPdf(bytes: Uint8Array, password?: string): Promise<{ pages: PageText[]; qrs: FoundQr[] }>;
  readImage(bytes: Uint8Array, mime: string): Promise<FoundQr[]>;
}

export interface ReadQr {
  found: FoundQr;
  result: QrParseResult;
  /** SHA-256 of issuer NIF + document id (field G). */
  docKey?: string;
  /** Set when an invoice with the same issuer and document id is already stored. */
  duplicateInvoiceId?: string;
}

export type FileKind = 'pdf' | 'image';

export type IngestOutcome =
  | { kind: 'duplicate_file'; fileHash: string; invoiceId: string }
  | { kind: 'needs_password'; reason: PasswordProblem }
  | { kind: 'unsupported' }
  | {
      kind: 'read';
      fileHash: string;
      fileKind: FileKind;
      mime: string;
      pages: PageText[];
      qrs: ReadQr[];
      qrStatus: 'ok' | 'missing' | 'invalid';
      /** The password that opened the PDF, if one was needed. */
      usedPassword?: string;
    };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export function detectKind(bytes: Uint8Array, mime: string): FileKind | null {
  if (mime === 'application/pdf' || PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return 'pdf';
  }
  if (mime.startsWith('image/')) return 'image';
  return null;
}

export async function docKeyFor(issuerNif: string, docId: string): Promise<string> {
  return sha256Hex(`${issuerNif}|${docId}`);
}

async function readPdfWithPasswords(
  bytes: Uint8Array,
  passwords: readonly string[],
  deps: IngestDeps,
): Promise<
  | { ok: true; pages: PageText[]; qrs: FoundQr[]; usedPassword?: string }
  | { ok: false; reason: PasswordProblem }
> {
  try {
    return { ok: true, ...(await deps.readPdf(bytes)) };
  } catch (error) {
    if (!(error instanceof PdfPasswordError)) throw error;
  }
  for (const password of passwords) {
    try {
      return { ok: true, ...(await deps.readPdf(bytes, password)), usedPassword: password };
    } catch (error) {
      if (!(error instanceof PdfPasswordError)) throw error;
    }
  }
  return { ok: false, reason: passwords.length > 0 ? 'incorrect' : 'needed' };
}

/**
 * Reads one file. `passwords` are tried in order if the PDF is protected
 * (e.g. the holder's NIF from the settings, then what the user typed).
 */
export async function ingestFile(
  input: { bytes: Uint8Array<ArrayBuffer>; mime: string },
  deps: IngestDeps,
  passwords: readonly string[] = [],
): Promise<IngestOutcome> {
  const fileKind = detectKind(input.bytes, input.mime);
  if (!fileKind) return { kind: 'unsupported' };

  const fileHash = await sha256Hex(input.bytes);
  const existing = await deps.findInvoiceIdByFileHash(fileHash);
  if (existing) return { kind: 'duplicate_file', fileHash, invoiceId: existing };

  let pages: PageText[] = [];
  let found: FoundQr[];
  let usedPassword: string | undefined;
  if (fileKind === 'pdf') {
    const read = await readPdfWithPasswords(input.bytes, passwords, deps);
    if (!read.ok) return { kind: 'needs_password', reason: read.reason };
    ({ pages, qrs: found, usedPassword } = read);
  } else {
    found = await deps.readImage(input.bytes, input.mime);
  }

  const qrs: ReadQr[] = [];
  for (const qr of found) {
    const result = parseFiscalQr(qr.text);
    const read: ReadQr = { found: qr, result };
    if (result.ok && result.qr.docId) {
      read.docKey = await docKeyFor(result.qr.issuerNif, result.qr.docId);
      const duplicate = await deps.findInvoiceIdByDocKey(read.docKey);
      if (duplicate) read.duplicateInvoiceId = duplicate;
    }
    qrs.push(read);
  }

  const qrStatus = qrs.length === 0 ? 'missing' : qrs.some((qr) => qr.result.ok) ? 'ok' : 'invalid';
  const outcome: IngestOutcome = {
    kind: 'read',
    fileHash,
    fileKind,
    mime: input.mime || (fileKind === 'pdf' ? 'application/pdf' : 'image/*'),
    pages,
    qrs,
    qrStatus,
  };
  if (usedPassword !== undefined) outcome.usedPassword = usedPassword;
  return outcome;
}
