import { describe, expect, it } from 'vitest';
import { productFromLines, storeFromText } from './purchase-reading';

describe('storeFromText', () => {
  it('knows the frequent stores wherever they are written', () => {
    expect(storeFromText('--- Página 1 ---\nFATURA FR 2026/12\nWORTEN - EQUIPAMENTOS')).toBe(
      'Worten',
    );
  });

  it('takes the first line with a name, without the company form', () => {
    expect(
      storeFromText(
        '--- Página 1 ---\nFatura simplificada\nLoja do Bairro, Lda. | NIF 500000000\nRua Direita 1, 4000-123 Porto',
      ),
    ).toBe('Loja do Bairro');
  });

  it('gives nothing for a text without a name', () => {
    expect(storeFromText('--- Página 1 ---\n12,50\n2026-11-25')).toBe('');
  });
});

describe('productFromLines', () => {
  it('is the good of highest amount, leaving out delivery, taxes and discounts', () => {
    expect(
      productFromLines([
        { kind: 'other', description: 'Entrega ao domicílio', amountCents: 50000 },
        { kind: 'equipment', description: 'Máquina de lavar Bosch Serie 4', amountCents: 39900 },
        { kind: 'other', description: 'Cabo', amountCents: 999 },
        { kind: 'tax', description: 'Ecovalor', amountCents: 60000 },
        { kind: 'discount', description: 'Campanha', amountCents: -5000 },
      ]),
    ).toBe('Máquina de lavar Bosch Serie 4');
    expect(productFromLines([])).toBe('');
  });
});
