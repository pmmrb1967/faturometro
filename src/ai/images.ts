/**
 * Images for the free AI (browser only): photos made smaller and scanned PDF
 * pages drawn as JPEG, at most ~1600 px on the longer side, as in Validómetro.
 * Done on the device: the server only passes the bytes on.
 */
import { fromBase64, toBase64 } from '../lib/crypto';
import { FREE_MAX_IMAGES, type FreeImage } from './free';
import { AiError, type InvoiceSource } from './provider';

const MAX_SIDE = 1600;
const QUALITY = 0.75;

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<FreeImage> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('JPEG encoding failed');
  return { mime: 'image/jpeg', base64: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return [canvas, context];
}

async function shrinkPhoto(mime: string, base64: string): Promise<FreeImage> {
  const bitmap = await createImageBitmap(new Blob([fromBase64(base64)], { type: mime }));
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const [canvas, context] = canvasOf(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToJpeg(canvas);
}

async function scannedPages(base64: string): Promise<FreeImage[]> {
  const { getDocument } = await import('pdfjs-dist');
  // The worker is set up by src/pdf/browser.ts.
  await import('../pdf/browser');
  const task = getDocument({ data: fromBase64(base64) });
  try {
    const pdf = await task.promise;
    // Never only part of the invoice.
    if (pdf.numPages > FREE_MAX_IMAGES) throw new AiError('too_large');
    const images: FreeImage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: MAX_SIDE / Math.max(base.width, base.height),
      });
      const [canvas, context] = canvasOf(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      images.push(await canvasToJpeg(canvas));
    }
    return images;
  } finally {
    await task.destroy();
  }
}

export async function prepareFreeImages(
  source: Exclude<InvoiceSource, { kind: 'text' }>,
): Promise<FreeImage[]> {
  if (source.kind === 'pdf') return scannedPages(source.base64);
  const pages = [source, ...(source.more ?? [])];
  if (pages.length > FREE_MAX_IMAGES) throw new AiError('too_large');
  return Promise.all(pages.map((page) => shrinkPhoto(page.mime, page.base64)));
}
