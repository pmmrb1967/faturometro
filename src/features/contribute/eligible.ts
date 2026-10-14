/** When to offer "Contribuir com este layout", and which values must never leave the browser. */
import type { ExtractedInvoice } from '../../parsers/types';
import type { FiscalQr } from '../../qr/parse';

const FINAL_CONSUMER = '999999990';

/** PDFs with text whose layout no parser knows, or whose parser failed the QR check. */
export function shouldOffer(input: {
  fileKind: 'pdf' | 'image';
  hasText: boolean;
  parserId?: string;
  validation?: 'passed' | 'failed' | 'not_checked';
}): boolean {
  return (
    input.fileKind === 'pdf' && input.hasText && (!input.parserId || input.validation === 'failed')
  );
}

/** Values read from the invoice that identify the person: always masked in a contribution. */
export function personalValues(input: {
  qrs: FiscalQr[];
  extraction?: ExtractedInvoice;
  ownNif?: string;
  /** The account email: its local part often holds the person's name. */
  email?: string;
}): string[] {
  const values = [
    ...input.qrs.map((qr) => qr.buyerNif),
    input.ownNif,
    input.extraction?.customerNumber?.value,
    input.extraction?.supplyPointId?.value,
    input.email?.split('@')[0],
  ].filter((value): value is string => Boolean(value?.trim()) && value !== FINAL_CONSUMER);
  return [...new Set(values)];
}
