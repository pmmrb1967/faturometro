import { describe, expect, it } from 'vitest';
import { anonymizeText, isNif } from './anonymize';

/** A made-up invoice (no real person, supplier or number). */
const INVOICE = `--- Página 1 ---
Energia Exemplo, S.A. | NIF 503504564
Exmo. Senhor
Joaquim Ferreira Antunes
Rua das Flores, 12, 2.º Esq.
1200-195 Lisboa
Fatura n.º FT 2026A/123 | ATCUD: JJ37MGK3-123
Data de emissão: 14/10/2026 | Vencimento 2026-10-30
N.º Cliente: 4321 8765 | Contrato n.º 987654321
NIF: 123456789 | Titular: Maria Costa
CPE: PT 0002 0000 1234 5678 XY
IBAN PT50 0035 0123 4567 8901 2345 6
Contacto: 912 345 678 ou joaquim.antunes@exemplo.pt
Potência contratada 6,90 kVA | IVA 23% | IVA 6 %
Energia simples | 245 kWh | 0,1532 | 37,53
Total a pagar | 1.234,56 €
Débito direto, referência ADC 12345678901`;

describe('anonymizeText', () => {
  it('checks NIFs with the check digit', () => {
    expect(isNif('123456789')).toBe(true);
    expect(isNif('123456780')).toBe(false);
  });

  it('removes the personal data of an invoice', () => {
    const { text, removed } = anonymizeText(INVOICE);
    for (const secret of [
      'Joaquim',
      'Antunes',
      'Ferreira',
      'Flores',
      '1200-195',
      'Lisboa',
      '123456789',
      '4321 8765',
      '987654321',
      'Maria',
      'Costa',
      'PT50',
      '912 345 678',
      'joaquim.antunes',
      '12345678901',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(removed.NOME).toBeGreaterThanOrEqual(2);
    expect(removed.IBAN).toBe(1);
  });

  it('keeps what the extraction needs', () => {
    const { text } = anonymizeText(INVOICE);
    for (const kept of [
      'FT 2026A/123',
      'JJ37MGK3-123',
      '14/10/2026',
      '2026-10-30',
      'PT 0002 0000 1234 5678 XY',
      '6,90 kVA',
      '23%',
      '6 %',
      '245 kWh',
      '0,1532',
      '37,53',
      '1.234,56 €',
      'Energia Exemplo',
    ]) {
      expect(text, kept).toContain(kept);
    }
  });

  it('removes the values the app knows, wherever they are', () => {
    const { text } = anonymizeText('Contribuinte 123 456 789. Ana Sousa Lopes paga.', {
      known: ['123456789', 'Ana Sousa'],
    });
    expect(text).not.toMatch(/123|Ana|Sousa/);
    expect(text).toContain('Lopes');
  });

  it('does not keep part of a dotted NIF as an amount', () => {
    expect(anonymizeText('NIF 123.456.789').text).not.toMatch(/\d{3}/);
  });
});
