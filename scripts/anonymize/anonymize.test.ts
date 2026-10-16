import { describe, expect, it } from 'vitest';
import { Anonymizer, isValidNif } from './anonymize';

// All values below are synthetic.
const KEY = new Uint8Array(32).fill(7);
const ISSUER_NIF = '500000000';
const CUSTOMER_NIF = '123456789';

function make(terms: string[] = []) {
  return new Anonymizer({ terms, keepNifs: [ISSUER_NIF], key: KEY });
}

describe('isValidNif', () => {
  it('validates the check digit', () => {
    expect(isValidNif(CUSTOMER_NIF)).toBe(true);
    expect(isValidNif(ISSUER_NIF)).toBe(true);
    expect(isValidNif('123456788')).toBe(false);
    expect(isValidNif('12345678')).toBe(false);
  });
});

describe('Anonymizer.text', () => {
  it('replaces customer NIFs with valid NIFs of the same type, keeping the issuer', () => {
    const anon = make();
    const output = anon.text(`NIF cliente ${CUSTOMER_NIF} / NIF ${ISSUER_NIF}`);
    const [, fake] = /cliente (\d{9})/.exec(output) ?? [];
    expect(fake).toBeDefined();
    expect(fake).not.toBe(CUSTOMER_NIF);
    expect(fake?.[0]).toBe('1');
    expect(isValidNif(fake ?? '')).toBe(true);
    expect(output).toContain(ISSUER_NIF);
  });

  it('is consistent within a run', () => {
    const anon = make();
    expect(anon.text(CUSTOMER_NIF)).toBe(anon.text(`${CUSTOMER_NIF}`));
    expect(anon.text('Cliente 4455667788')).toBe(anon.text('Cliente 4455667788'));
  });

  it('depends on the key', () => {
    const other = new Anonymizer({ terms: [], keepNifs: [], key: new Uint8Array(32).fill(9) });
    expect(make().text('Conta 4455667788')).not.toBe(other.text('Conta 4455667788'));
  });

  it('replaces configured terms ignoring case, accents and spacing, keeping length', () => {
    const anon = make(['João da Silva', 'Rua das Flores 12']);
    const output = anon.text('Exmo. Sr. JOAO DA  SILVA, rua das flores 12');
    expect(output).not.toMatch(/jo[aã]o/i);
    expect(output).not.toMatch(/silva/i);
    expect(output).not.toMatch(/flores/i);
    expect(output.startsWith('Exmo. Sr. ')).toBe(true);
    expect(output).toHaveLength('Exmo. Sr. JOAO DA  SILVA, rua das flores 12'.length);
  });

  it('replaces individual words of a term when split across text items', () => {
    const anon = make(['Maria Albertina Sousa']);
    expect(anon.text('Albertina')).not.toMatch(/albertina/i);
    expect(anon.text('Sousa')).not.toMatch(/sousa/i);
  });

  it('does not replace a term inside a longer word', () => {
    const anon = make(['Sousa']);
    expect(anon.text('Sousas')).toBe('Sousas');
  });

  it('replaces emails', () => {
    const output = make().text('Email: maria.sousa@example.pt');
    expect(output).not.toContain('maria.sousa');
    expect(output).toMatch(/^Email: [a-z]+\.[a-z]+@[a-z]+\.[a-z]+$/);
  });

  it('replaces IBANs with a valid IBAN keeping the spacing', () => {
    const iban = 'PT50 0002 0123 1234 5678 9015 4';
    const output = make().text(`IBAN ${iban}`);
    const fake = output.slice(5);
    expect(fake).not.toBe(iban);
    expect(fake).toMatch(/^PT50 \d{4} \d{4} \d{4} \d{4} \d{4} \d$/);
    expect(ibanIsValid(fake)).toBe(true);
  });

  it('replaces postal codes and long digit runs but keeps amounts and dates', () => {
    const output = make().text(
      '1000-001 Lisboa | CPE PT0002000012345678XY | 1234,56 € | 20260131 | 123456,78',
    );
    expect(output).not.toContain('1000-001');
    expect(output).toMatch(/^\d{4}-\d{3} Lisboa/);
    expect(output).not.toContain('0002000012345678');
    expect(output).toMatch(/CPE PT\d{16}XY/);
    expect(output).toContain('1234,56 €');
    expect(output).toContain('20260131');
    expect(output).toContain('123456,78');
  });

  it('replaces digit groups separated by spaces, keeping the spacing', () => {
    const anon = make();
    const output = anon.text('NIF 123 456 789 | Autorização 987 654 321 12 | Tel. 912 345 678');
    expect(output).toMatch(
      /^NIF \d{3} \d{3} \d{3} \| Autorização \d{3} \d{3} \d{3} \d{2} \| Tel\. \d{3} \d{3} \d{3}$/,
    );
    expect(output).not.toContain('123 456 789');
    expect(output).not.toContain('987 654 321');
    expect(output).not.toContain('912 345 678');
    expect(isValidNif(output.slice(4, 15).replace(/ /g, ''))).toBe(true);
  });

  it('uses the same replacement for a NIF with and without spaces', () => {
    const anon = make();
    const compact = anon.text(CUSTOMER_NIF);
    expect(anon.text('123 456 789').replace(/ /g, '')).toBe(compact);
  });

  it('keeps company and public-body NIFs (starting with 5 or 6), with or without spaces', () => {
    const anon = make();
    expect(anon.text('NIPC 501 234 560 e 600000001')).toBe('NIPC 501 234 560 e 600000001');
  });

  it('does not treat amounts with space thousands as digit groups', () => {
    expect(make().text('Total 1 234 567,89 €')).toBe('Total 1 234 567,89 €');
  });

  it('replaces the visible digits of masked numbers', () => {
    const anon = make();
    const output = anon.text('IBAN PT50*****************4845');
    expect(output).toMatch(/^IBAN PT\d{2}\*{17}\d{4}$/);
    expect(output).not.toContain('4845');
    const irregular = anon.text('PT5012345678901****404**5');
    expect(irregular).toMatch(/^PT\d{13}\*{4}\d{3}\*{2}\d$/);
    expect(irregular).not.toContain('404');
  });

  it('replaces postal codes with spaces around the hyphen', () => {
    const output = make().text('4455 - 237 Localidade');
    expect(output).toMatch(/^\d{4} - \d{3} Localidade$/);
    expect(output).not.toContain('4455');
  });

  it('replaces postal codes split across text items, consistently', () => {
    const anon = make();
    anon.scanPage(['Rua X', '4455', '-', '237', 'Localidade']);
    const four = anon.text('4455');
    const three = anon.text('237');
    expect(four).toMatch(/^\d{4}$/);
    expect(four).not.toBe('4455');
    expect(three).toMatch(/^\d{3}$/);
    expect(three).not.toBe('237');
    expect(anon.text('4455-237')).toBe(`${four}-${three}`);
    expect(() => anon.assertNoLeaks(['4455 - 237'])).toThrow(/leak/);
  });

  it('scrambles opaque encoded strings (fonts used to draw payment codes)', () => {
    const output = make().text('jcbZGT0DY7;7s51uC;xqZjcbZ');
    expect(output).not.toBe('jcbZGT0DY7;7s51uC;xqZjcbZ');
    expect(output).toHaveLength('jcbZGT0DY7;7s51uC;xqZjcbZ'.length);
  });

  it('replaces 5-digit customer numbers', () => {
    expect(make().text('Cliente / Conta: 53305 / 001')).toMatch(/^Cliente \/ Conta: \d{5} \/ 001$/);
    expect(make().text('Cliente / Conta: 53305 / 001')).not.toContain('53305');
  });

  it('replaces numbers that are part of a term on their own (door numbers)', () => {
    const anon = make(['Rua das Flores, 217 R/C']);
    expect(anon.text('Alam. das Flores 217 RC ESQ')).not.toContain('217');
    expect(anon.text('217')).not.toBe('217');
  });

  it('replaces barcode-font gibberish entirely', () => {
    const encoded = 'B^^^Bved hZ5jG*s|T 5VUL;(;HB^^^B';
    expect(make().text(encoded)).toBe('#'.repeat(encoded.length));
  });

  it('keeps ordinary text with some punctuation', () => {
    const line = '31d/31d x (3,35 € x 1,00%) | -0,03 [IVA] {nota}';
    expect(make().text(line)).toBe(line);
  });

  it('replaces numbers written with dots as thousands separators, but not amounts', () => {
    const anon = make();
    const output = anon.text(
      'NIF 123.456.789 | Doc 017.339.659/08/2026 | Capital 1.576.326.759 Euros | 1.234.567,89 €',
    );
    expect(output).not.toContain('123.456.789');
    expect(output).toMatch(/^NIF \d{3}\.\d{3}\.\d{3} \| Doc \d{3}\.\d{3}\.\d{3}\/08\/2026/);
    expect(output).toContain('1.576.326.759 Euros');
    expect(output).toContain('1.234.567,89 €');
    expect(anon.text(CUSTOMER_NIF)).toBe(output.slice(4, 15).replace(/\./g, ''));
  });

  it('keeps short numbers', () => {
    expect(make().text('Fatura n.º 2026/123 de 3,45 kVA')).toBe('Fatura n.º 2026/123 de 3,45 kVA');
  });
});

describe('Anonymizer.qr', () => {
  const qr =
    `A:${ISSUER_NIF}*B:${CUSTOMER_NIF}*C:PT*D:FT*E:N*F:20260115*G:FT 2026/1234567*H:ABCD1234-1234567` +
    '*I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:abcd*R:1234*S:MB;12345;123456789;123.00';

  it('keeps issuer, dates and amounts, and anonymizes sensitive fields consistently with the text', () => {
    const anon = make();
    const text = anon.text(`Contribuinte ${CUSTOMER_NIF} Documento FT 2026/1234567`);
    const output = anon.qr(qr);
    const fields: Record<string, string> = Object.fromEntries(
      output
        .split('*')
        .map((field) => [field.slice(0, field.indexOf(':')), field.slice(field.indexOf(':') + 1)]),
    );

    expect(fields.A).toBe(ISSUER_NIF);
    expect(fields.F).toBe('20260115');
    expect(fields.O).toBe('123.00');
    expect(fields.N).toBe('23.00');
    expect(fields.B).not.toBe(CUSTOMER_NIF);
    expect(text).toContain(fields.B);
    expect(text).toContain(fields.G);
    expect(fields.G).not.toBe('FT 2026/1234567');
    expect(fields.S).toMatch(/^MB;\d{5};\d{9};123\.00$/);
    expect(fields.S).not.toContain('123456789');
  });

  it('keeps the final consumer NIF', () => {
    expect(make().qr('A:500000000*B:999999990*C:PT')).toBe('A:500000000*B:999999990*C:PT');
  });
});

describe('Anonymizer.page', () => {
  it('scrambles a term split across text items, in place', () => {
    const anon = make(['Maria Sousa']);
    const items = ['Titular:', 'M', 'A', 'R', 'I', 'A', 'Lisboa', 'A'];
    const out = anon.page(items);
    expect(out.slice(1, 6).join('').toLowerCase()).not.toBe('maria');
    // Untouched elsewhere: the label, the town, and the same letter in another item.
    expect(out[0]).toBe('Titular:');
    expect(out[6]).toBe('Lisboa');
    expect(out[7]).toBe('A');
    expect(() => anon.assertNoLeaks({ items: out, joined: [out.join('')] })).not.toThrow();
  });

  it('replaces a number printed as digit groups in separate items, like the compact form', () => {
    const anon = make();
    const compact = anon.text(`NIF ${CUSTOMER_NIF}`).slice(4);
    const out = anon.page(['NIF', '123', ' ', '456', '789', '/', '26']);
    expect(out.slice(1, 5).join('').replace(/ /g, '')).toBe(compact);
    expect(out[2]).toBe(' ');
    expect(out.slice(5)).toEqual(['/', '26']);
    // Two groups, or a company NIF, stay as they are.
    expect(make().page(['123', '456', '/'])).toEqual(['123', '456', '/']);
    expect(make().page(['500', '000', '000'])).toEqual(['500', '000', '000']);
  });

  it('still anonymizes each item on its own', () => {
    const anon = make(['Maria Sousa']);
    expect(anon.page(['Maria Sousa'])[0]).not.toMatch(/maria/i);
  });
});

describe('Anonymizer.assertNoLeaks', () => {
  it('passes on anonymized output and fails when a sensitive value remains', () => {
    const anon = make(['Maria Sousa']);
    const output = anon.text(`Maria Sousa ${CUSTOMER_NIF}`);
    expect(() => anon.assertNoLeaks([output])).not.toThrow();
    expect(() => anon.assertNoLeaks([output, 'MARIA SOUSA'])).toThrow(/leak/);
    expect(() => anon.assertNoLeaks([`${output} ${CUSTOMER_NIF}`])).toThrow(/leak/);
  });

  it('does not report the leaked values in the error message', () => {
    const anon = make(['Maria Sousa']);
    expect(() => anon.assertNoLeaks(['Maria Sousa'])).toThrow(/^Anonymization leak: \d+ sensitive/);
    try {
      anon.assertNoLeaks(['Maria Sousa']);
    } catch (error) {
      expect(String(error)).not.toMatch(/maria/i);
    }
  });

  it('says which term leaked and how, without the value', () => {
    const anon = make(['Rua Exemplo 12', 'Maria Sousa']);
    const message = (input: Parameters<typeof anon.assertNoLeaks>[0]) => {
      try {
        anon.assertNoLeaks(input);
        return '';
      } catch (error) {
        return String(error);
      }
    };
    // Split across items: only visible when the page's items are joined.
    const split = message({ items: ['Mar', 'ia'], joined: ['Maria'] });
    expect(split).toMatch(/word of term 2 split across text items/);
    expect(split).not.toMatch(/maria|sousa/i);
    expect(message({ items: ['Maria'] })).toMatch(/word of term 2 as a word in a text item/);
    expect(message({ items: ['M a r i a'] })).toMatch(/spaced out in a text item/);
  });

  it('does not count a value inside a longer word as a leak', () => {
    const anon = make(['Rui Matos']);
    // "Matos" inside "Matosinhos" (a town), in an item and in the joined page.
    expect(() =>
      anon.assertNoLeaks({ items: ['Matosinhos', 'Porto'], joined: ['MatosinhosPorto'] }),
    ).not.toThrow();
    // Nor words of the text that spell it without their spaces ("es quer do").
    const address = make(['Rua Nova 5 Esquerdo']);
    expect(() =>
      address.assertNoLeaks({
        items: ['provenientes', ' quer do próprio'],
        joined: ['provenientes quer do próprio'],
      }),
    ).not.toThrow();
    expect(address.page(['provenientes', ' quer do próprio'])).toEqual([
      'provenientes',
      ' quer do próprio',
    ]);
    // But not when the page joins two items into it.
    expect(() => anon.assertNoLeaks({ items: ['Ma', 'tos'], joined: ['Matos'] })).toThrow(/split/);
  });
});

function ibanIsValid(iban: string): boolean {
  const compact = iban.replace(/\s/g, '');
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
