import { createCanvas } from '@napi-rs/canvas';
import { getDocument, PasswordResponses } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readBarcodes } from 'zxing-wasm/reader';

type TextContentItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];
type TextItem = Extract<TextContentItem, { str: string }>;

export interface ExtractedTextItem {
  str: string;
  /** Top-left origin, y grows downwards, PDF points. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface ExtractedPage {
  page: number;
  width: number;
  height: number;
  items: ExtractedTextItem[];
}

export interface ExtractedPdf {
  pages: ExtractedPage[];
  qr: string | null;
  qrPage: number | null;
}

/** Render scale for QR decoding (the spec's minimum QR size is 30 mm). */
const QR_RENDER_SCALE = 3;

const round = (value: number) => Math.round(value * 100) / 100;

export class PdfPasswordError extends Error {
  readonly reason: 'needed' | 'incorrect';

  constructor(reason: 'needed' | 'incorrect') {
    super(reason === 'needed' ? 'PDF is password protected' : 'Incorrect PDF password');
    this.reason = reason;
  }
}

export async function extractPdf(data: Uint8Array, password?: string): Promise<ExtractedPdf> {
  const task = getDocument({ data, password, verbosity: 0 });
  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      const code = (error as Error & { code?: number }).code;
      throw new PdfPasswordError(
        code === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'needed',
      );
    }
    throw error;
  }

  try {
    const pages: ExtractedPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items
        .filter((item): item is TextItem => 'str' in item && item.str.trim().length > 0)
        .map((item) => {
          const [, , , , x = 0, y = 0] = item.transform as number[];
          return {
            str: item.str,
            x: round(x),
            y: round(viewport.height - y),
            width: round(item.width),
            height: round(item.height),
            fontName: item.fontName,
          };
        });
      pages.push({
        page: number,
        width: round(viewport.width),
        height: round(viewport.height),
        items,
      });
    }

    const { qr, qrPage } = await findQr(pdf);
    return { pages, qr, qrPage };
  } finally {
    await task.destroy();
  }
}

/** The spec allows the QR on the first or last page; try those first, then the rest. */
async function findQr(
  pdf: PDFDocumentProxy,
): Promise<{ qr: string | null; qrPage: number | null }> {
  const order = [
    ...new Set([pdf.numPages, 1, ...Array.from({ length: pdf.numPages }, (_, i) => i + 1)]),
  ];
  for (const number of order) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: QR_RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const png = await canvas.encode('png');
    const results = await readBarcodes(new Uint8Array(png), {
      formats: ['QRCode'],
      tryHarder: true,
    });
    const fiscal = results.find((result) => /^A:\d+\*B:/.test(result.text));
    if (fiscal) return { qr: fiscal.text, qrPage: number };
  }
  return { qr: null, qrPage: null };
}
