/**
 * PDF text extraction shared by the app (browser build of pdf.js) and the
 * scripts (legacy build): both expose the same document/page API.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type TextContentItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];
type PdfTextItem = Extract<TextContentItem, { str: string }>;

export interface TextItem {
  str: string;
  /** Top-left origin, y grows downwards, PDF points. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

export type PasswordProblem = 'needed' | 'incorrect';

export class PdfPasswordError extends Error {
  readonly reason: PasswordProblem;

  constructor(reason: PasswordProblem) {
    super(reason === 'needed' ? 'PDF is password protected' : 'Incorrect PDF password');
    this.name = 'PdfPasswordError';
    this.reason = reason;
  }
}

/** pdf.js PasswordResponses: NEED_PASSWORD = 1, INCORRECT_PASSWORD = 2. */
const INCORRECT_PASSWORD = 2;

/** Converts pdf.js password exceptions into PdfPasswordError; rethrows anything else. */
export function toPasswordError(error: unknown): never {
  if (error instanceof Error && error.name === 'PasswordException') {
    const code = (error as Error & { code?: number }).code;
    throw new PdfPasswordError(code === INCORRECT_PASSWORD ? 'incorrect' : 'needed');
  }
  throw error;
}

const round = (value: number) => Math.round(value * 100) / 100;

export async function extractText(pdf: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((item): item is PdfTextItem => 'str' in item && item.str.trim().length > 0)
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
  return pages;
}
