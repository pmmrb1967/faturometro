import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { PDFPageProxy } from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { prepareZXingModule } from 'zxing-wasm/reader';
import { extractText, toPasswordError, type PageText } from '../../src/pdf/text';
import { scanPdfQrs, type FoundQr } from '../../src/qr/scan';

export { PdfPasswordError } from '../../src/pdf/text';

// Load the zxing WASM from node_modules instead of the default CDN.
const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer,
  },
});

export interface ExtractedPdf {
  pages: PageText[];
  qrs: FoundQr[];
}

async function renderPage(page: PDFPageProxy, scale: number): Promise<Uint8Array> {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return new Uint8Array(await canvas.encode('png'));
}

export async function extractPdf(data: Uint8Array, password?: string): Promise<ExtractedPdf> {
  const task = getDocument({ data, password, verbosity: 0 });
  try {
    const pdf = await task.promise.catch(toPasswordError);
    return { pages: await extractText(pdf), qrs: await scanPdfQrs(pdf, renderPage) };
  } finally {
    await task.destroy();
  }
}
