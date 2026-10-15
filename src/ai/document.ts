/** What is sent to the AI for one invoice, and how it is shown to the user first. */
import { toBase64 } from '../lib/crypto';
import type { PageText } from '../pdf/text';
import { rows } from '../parsers/utils';
import type { InvoiceSource } from './provider';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** Page text, row by row (cells joined with " | "), pages separated. */
export function documentText(pages: PageText[]): string {
  return pages
    .map((page, index) =>
      [`--- Página ${index + 1} ---`, ...rows(page).map((row) => row.text)].join('\n'),
    )
    .join('\n\n')
    .trim();
}

/**
 * The cheapest faithful form: the PDF's text when it has one; otherwise the
 * file (scanned PDF or photo). A PDF opened with a password cannot be sent as
 * a file: the API cannot open it.
 */
export function invoiceSource(input: {
  pages: PageText[];
  bytes: Uint8Array;
  mime: string;
  fileKind: 'pdf' | 'image';
  protectedPdf: boolean;
  /** Photos of the invoice's other pages. */
  morePhotos?: { bytes: Uint8Array; mime: string }[];
}): InvoiceSource | undefined {
  const text = documentText(input.pages);
  const hasText = input.pages.some((page) => page.items.some((item) => item.str.trim()));
  if (input.fileKind === 'pdf') {
    if (hasText) return { kind: 'text', text };
    return input.protectedPdf ? undefined : { kind: 'pdf', base64: toBase64(input.bytes) };
  }
  const mime = IMAGE_TYPES.find((type) => type === input.mime) as ImageType | undefined;
  if (!mime) return undefined;
  const more = (input.morePhotos ?? []).flatMap((photo) => {
    const type = IMAGE_TYPES.find((candidate) => candidate === photo.mime) as ImageType | undefined;
    return type ? [{ mime: type, base64: toBase64(photo.bytes) }] : [];
  });
  return {
    kind: 'image',
    mime,
    base64: toBase64(input.bytes),
    ...(more.length > 0 ? { more } : {}),
  };
}
