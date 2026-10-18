/**
 * Browser-only pdf.js and zxing setup. Every asset (pdf.js worker, zxing WASM)
 * is bundled with the app: nothing is fetched from a CDN.
 */
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { prepareZXingModule } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { scanImageQrs, scanPdfQrs, type FoundQr } from '../qr/scan';
import { installReadableStreamIterator } from './polyfills';
import { extractText, toPasswordError, type PageText } from './text';

installReadableStreamIterator();
GlobalWorkerOptions.workerSrc = workerUrl;

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? zxingWasmUrl : prefix + path,
  },
});

/** Text and every fiscal QR code of a PDF; throws PdfPasswordError when a (correct) password is needed. */
export async function readPdf(
  data: Uint8Array,
  password?: string,
): Promise<{ pages: PageText[]; qrs: FoundQr[] }> {
  // pdf.js transfers the buffer to its worker: pass a copy so the caller keeps the original.
  const task = getDocument({ data: data.slice(), password });
  try {
    const pdf: PDFDocumentProxy = await task.promise.catch(toPasswordError);
    return { pages: await extractText(pdf), qrs: await scanPdfQrs(pdf, renderPage) };
  } finally {
    await task.destroy();
  }
}

/** Only the text, for documents without a fiscal QR code (insurance proposals). */
export async function readPdfText(
  data: Uint8Array,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const task = getDocument({ data: data.slice() });
  try {
    const pdf: PDFDocumentProxy = await task.promise.catch(toPasswordError);
    return { pages: await extractText(pdf), pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

export async function readImage(data: Uint8Array, mime: string): Promise<FoundQr[]> {
  return scanImageQrs(new Blob([data.slice()], { type: mime }));
}

export async function renderPage(page: PDFPageProxy, scale: number): Promise<ImageData> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  return image;
}
