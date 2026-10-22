/**
 * Ingestion pipeline, steps 0–2 (PLAN.md section 6): file → hash and
 * deduplication → PDF password → text and every fiscal QR code, then steps
 * 3–5: layout parser (by issuer NIF or text fingerprint) and cross-validation.
 * PDF/image reading is injected, so this module has no browser dependencies.
 */
import { sha256Hex } from '../../lib/crypto';
import { PdfPasswordError, type PageText, type PasswordProblem } from '../../pdf/text';
import { readPolicyDocument, type PolicyDocument } from '../../parsers/policy-documents';
import { directDebitInText } from '../../parsers/direct-debit';
import { findParser } from '../../parsers/registry';
import type { ExtractedInvoice } from '../../parsers/types';
import { parseFiscalQr, type FiscalQr, type QrParseResult } from '../../qr/parse';
import type { FoundQr } from '../../qr/scan';
import { validateExtraction, type ValidationResult } from './validate';

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
  parsed?: ParsedDocument;
}

/** Steps 4–5: what a layout parser read, and how it compares with the QR code. */
export interface ParsedDocument {
  parserId: string;
  providerName: string;
  parserVersion: string;
  extraction: ExtractedInvoice;
  check: ValidationResult;
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
      /** Without a usable QR code: what a parser read from the text (to prefill the form). */
      parsed?: ParsedDocument;
      /** Without a QR code: an insurance document that updates a policy (not an invoice). */
      policyDocument?: PolicyDocument;
      /** The password that opened the PDF, if one was needed. */
      usedPassword?: string;
      /** Direct debit day said in the text, whatever the layout (a reader's own wins). */
      directDebitDate?: string;
    };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

/** A parser that throws never blocks ingestion (PLAN.md §6, step 4). */
export function runParser(
  pages: PageText[],
  qrs: FiscalQr[],
  qr?: FiscalQr,
): ParsedDocument | undefined {
  if (pages.length === 0) return undefined;
  const ctx = { pages, qrs };
  const parser = findParser(ctx, qr?.issuerNif);
  if (!parser) return undefined;
  try {
    const extraction = parser.parse(ctx, qr);
    return {
      parserId: parser.id,
      providerName: extraction.issuerName?.value ?? parser.name,
      parserVersion: parser.version,
      extraction,
      check: validateExtraction(extraction, qr),
    };
  } catch {
    return undefined;
  }
}

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

export async function readPdfWithPasswords(
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

  const qrs = await readFoundQrs(found, deps);

  const parsedQrs = qrs.flatMap((qr) => (qr.result.ok ? [qr.result.qr] : []));
  for (const qr of qrs) {
    if (!qr.result.ok) continue;
    const parsed = runParser(pages, parsedQrs, qr.result.qr);
    if (parsed) qr.parsed = parsed;
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
  const directDebitDate = directDebitInText(pages);
  if (directDebitDate) outcome.directDebitDate = directDebitDate;
  if (qrStatus !== 'ok') {
    const policyDocument = pages.length > 0 ? readPolicyDocument(pages) : null;
    if (policyDocument) outcome.policyDocument = policyDocument;
    const parsed = runParser(pages, []);
    if (parsed) outcome.parsed = parsed;
  }
  return outcome;
}

/** Parses the QR codes found in a file and flags invoices already stored. */
async function readFoundQrs(found: FoundQr[], deps: IngestDeps): Promise<ReadQr[]> {
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
  return qrs;
}

/**
 * Another page of a photographed invoice. Its QR code counts when the pages
 * so far had none (it is often on the first page, sometimes on another).
 */
export async function addPhotoPage(
  outcome: Extract<IngestOutcome, { kind: 'read' }>,
  input: { bytes: Uint8Array; mime: string },
  deps: IngestDeps,
): Promise<Extract<IngestOutcome, { kind: 'read' }>> {
  if (outcome.qrStatus === 'ok') return outcome;
  const qrs = await readFoundQrs(await deps.readImage(input.bytes, input.mime), deps);
  if (!qrs.some((qr) => qr.result.ok)) return outcome;
  return { ...outcome, qrs, qrStatus: 'ok' };
}
