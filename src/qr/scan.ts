/**
 * Finds every fiscal QR code in a PDF or image. Some documents carry several
 * (a Via Verde statement groups invoices from different issuers), so all
 * pages are scanned and every code is kept.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { readBarcodes } from 'zxing-wasm/reader';
import { looksLikeFiscalQr } from './parse';

export interface FoundQr {
  text: string;
  /** 1-based page number; undefined for images. */
  page?: number;
}

/** Renders a page to something zxing can read: ImageData (browser) or an encoded image (Node). */
export type PageRenderer = (page: PDFPageProxy, scale: number) => Promise<ImageData | Uint8Array>;

/** First pass at 3× (the spec's minimum QR size is 30 mm); retry larger if nothing is found. */
const SCALES = [3, 5] as const;

async function readQrs(image: ImageData | Uint8Array | Blob): Promise<string[]> {
  const results = await readBarcodes(image, {
    formats: ['QRCode'],
    tryHarder: true,
    maxNumberOfSymbols: 32,
  });
  return results.filter((result) => result.isValid).map((result) => result.text);
}

function keepFiscal(found: FoundQr[]): FoundQr[] {
  const seen = new Set<string>();
  return found.filter(({ text }) => {
    if (!looksLikeFiscalQr(text) || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export async function scanPdfQrs(pdf: PDFDocumentProxy, render: PageRenderer): Promise<FoundQr[]> {
  for (const scale of SCALES) {
    const found: FoundQr[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const image = await render(await pdf.getPage(number), scale);
      for (const text of await readQrs(image)) found.push({ text, page: number });
    }
    const fiscal = keepFiscal(found);
    if (fiscal.length > 0) return fiscal;
  }
  return [];
}

export async function scanImageQrs(image: Blob | Uint8Array): Promise<FoundQr[]> {
  return keepFiscal((await readQrs(image)).map((text) => ({ text })));
}

/** One frame of the live camera: a receipt has few codes, and the next frame comes right after. */
export async function scanFrameQrs(frame: ImageData): Promise<FoundQr[]> {
  const results = await readBarcodes(frame, {
    formats: ['QRCode'],
    tryHarder: true,
    tryInvert: false,
    maxNumberOfSymbols: 4,
  });
  return keepFiscal(results.filter((result) => result.isValid).map(({ text }) => ({ text })));
}
