import { describe, expect, it } from 'vitest';
import type { PageText } from '../pdf/text';
import { directDebitInText } from './direct-debit';

/** One page, one row per line of text. */
function page(...lines: string[]): PageText {
  return {
    page: 1,
    width: 595,
    height: 842,
    items: lines.map((str, index) => ({
      str,
      x: 40,
      y: 100 + index * 20,
      width: 300,
      height: 10,
      fontName: 'f1',
    })),
  };
}

describe('direct debit date in the text', () => {
  it('reads it from a letter sentence', () => {
    const letter = page(
      'Caro/a cliente,',
      'O seu seguro vai ser pago por débito direto a partir de 2026-10-24',
      'O valor a debitar na sua conta bancária é de 456,87 €.',
    );
    expect(directDebitInText([letter])).toBe('2026-10-24');
  });

  it('reads a label with the day-first date on the next row', () => {
    expect(directDebitInText([page('Débito direto a partir do dia:', '24/10/2026')])).toBe(
      '2026-10-24',
    );
  });

  it('looks at every page', () => {
    const first = page('Fatura/Recibo', 'Total: 456,87 €');
    const second = page('Pagamento por Débito Direto a partir de 24-10-2026.');
    expect(directDebitInText([first, second])).toBe('2026-10-24');
  });

  it('ignores other dates and sentences', () => {
    expect(directDebitInText([page('Data de emissão: 2026-09-26')])).toBeUndefined();
    expect(
      directDebitInText([page('Adira ao débito direto. A partir de 2026-10-24 há novos preços.')]),
    ).toBeUndefined();
    expect(directDebitInText([page('Pagamento por débito direto')])).toBeUndefined();
  });
});
