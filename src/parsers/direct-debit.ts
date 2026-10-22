/**
 * Any layout: the day a direct debit is taken, when the text says it in a
 * sentence ("vai ser pago por débito direto a partir de 2026-10-24",
 * "Débito direto a partir do dia: 24-10-2026"). Used when the reader (layout
 * parser or AI) did not find it.
 */
import type { PageText } from '../pdf/text';
import { date, normalize, rows } from './utils';

const DATE = String.raw`(\d{4}-\d{2}-\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})`;
/** "débito direto" then, within the same sentence, "a partir de/do (dia)" and the date. */
const DIRECT_DEBIT = new RegExp(
  String.raw`d[ée]bito direto[^.]{0,40}?a partir d[eo](?: dia)?:?\s*${DATE}`,
  'iu',
);

export function directDebitInText(pages: PageText[]): string | undefined {
  const text = normalize(
    pages
      .flatMap((page) => rows(page))
      .map((row) => row.items.map((item) => item.str).join(' '))
      .join(' '),
  );
  return date(DIRECT_DEBIT.exec(text)?.[1]) ?? undefined;
}
