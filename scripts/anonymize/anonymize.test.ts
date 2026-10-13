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
    expect(fields.S).toMatch(/^MB;12345;\d{9};123\.00$/);
    expect(fields.S).not.toContain('123456789');
  });

  it('keeps the final consumer NIF', () => {
    expect(make().qr('A:500000000*B:999999990*C:PT')).toBe('A:500000000*B:999999990*C:PT');
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
});

function ibanIsValid(iban: string): boolean {
  const compact = iban.replace(/\s/g, '');
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
