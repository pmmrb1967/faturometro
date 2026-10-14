import { describe, expect, it } from 'vitest';
import { findingText } from './audit-view';

describe('findingText', () => {
  it('writes unit prices with a comma and the unit', () => {
    expect(
      findingText({
        kind: 'price_changed',
        description: 'Energia Vazio',
        unit: 'kWh',
        before: '0.1650',
        after: '0.1820',
      }),
    ).toBe('Energia Vazio: o preço passou de 0,1650 €/kWh para 0,1820 €/kWh.');
    expect(
      findingText({
        kind: 'price_changed',
        description: 'Potência',
        unit: 'day',
        before: '0.3',
        after: '0.31',
      }),
    ).toBe('Potência: o preço passou de 0,3 €/dia para 0,31 €/dia.');
  });

  it('writes amounts in euros', () => {
    expect(
      findingText({ kind: 'discount_ended', description: 'Desconto Pacote', amountCents: 1000 }),
    ).toMatch(/^Desconto Pacote: o desconto de 10,00\s€ deixou de aparecer\.$/);
    expect(
      findingText({ kind: 'above_contracted', contractedCents: 3999, chargedCents: 4299 }),
    ).toMatch(/^Pagas 42,99\s€ de mensalidade, acima dos 39,99\s€ contratados\.$/);
  });
});
