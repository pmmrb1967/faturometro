import { describe, expect, it } from 'vitest';
import { auditInvoice, lineKey, needsAuditAlert, recurringCents, type AuditInput } from './audit';
import type { InvoiceLine } from './types';

type Line = Pick<InvoiceLine, 'kind' | 'description' | 'amountCents'> &
  Partial<Pick<InvoiceLine, 'quantity' | 'unit' | 'unitPrice' | 'period'>>;

const telecomBefore: Line[] = [
  { kind: 'base_fee', description: 'Pacote', amountCents: 4999 },
  { kind: 'discount', description: 'Desconto Pacote', amountCents: -1000 },
  { kind: 'equipment', description: 'Equipamentos', amountCents: 300 },
];

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    contract: { sector: 'telecom' },
    invoice: { id: 'i2', issueDate: '2026-10-01', totalCents: 4299 },
    lines: telecomBefore,
    previous: { id: 'i1', totalCents: 4299 },
    previousLines: telecomBefore,
    ...overrides,
  };
}

describe('lineKey', () => {
  it('ignores numbers, dates and accents in the description', () => {
    expect(lineKey({ kind: 'energy', description: 'Energia Vazio 01/09 a 15/09' })).toBe(
      lineKey({ kind: 'energy', description: 'energia vazio 16/10 a 31/10' }),
    );
    expect(lineKey({ kind: 'addon', description: 'Televisão' })).toBe(
      lineKey({ kind: 'addon', description: 'Televisao' }),
    );
    expect(lineKey({ kind: 'energy', period: 'empty', description: 'Energia' })).not.toBe(
      lineKey({ kind: 'energy', period: 'off_empty', description: 'Energia' }),
    );
  });
});

describe('auditInvoice', () => {
  it('finds nothing when the invoice repeats the previous one', () => {
    const audit = auditInvoice(input());
    expect(audit).toMatchObject({ detailed: true, findings: [], increased: false });
  });

  it('finds a fee change, an ended discount and a new charge', () => {
    const audit = auditInvoice(
      input({
        invoice: { id: 'i2', issueDate: '2026-10-01', totalCents: 7099 },
        lines: [
          { kind: 'base_fee', description: 'Pacote', amountCents: 5299 },
          { kind: 'equipment', description: 'Equipamentos', amountCents: 300 },
          { kind: 'addon', description: 'Desporto', amountCents: 1500 },
        ],
      }),
    );
    expect(audit.findings).toEqual([
      { kind: 'fee_changed', description: 'Pacote', beforeCents: 4999, afterCents: 5299 },
      { kind: 'new_charge', description: 'Desporto', amountCents: 1500 },
      { kind: 'discount_ended', description: 'Desconto Pacote', amountCents: 1000 },
    ]);
    expect(audit.increased).toBe(true);
    expect(needsAuditAlert(audit)).toBe(true);
  });

  it('finds a smaller fixed discount, but not on energy (it follows consumption)', () => {
    const lines: Line[] = [
      { kind: 'base_fee', description: 'Pacote', amountCents: 4999 },
      { kind: 'discount', description: 'Desconto Pacote', amountCents: -500 },
    ];
    const invoice = { id: 'i2', issueDate: '2026-10-01', totalCents: 4499 };
    expect(auditInvoice(input({ invoice, lines })).findings).toContainEqual({
      kind: 'discount_reduced',
      description: 'Desconto Pacote',
      beforeCents: 1000,
      afterCents: 500,
    });
    const energy = auditInvoice(
      input({
        contract: { sector: 'electricity' },
        previousLines: [{ kind: 'discount', description: 'Desc. energia', amountCents: -900 }],
        lines: [{ kind: 'discount', description: 'Desc. energia', amountCents: -400 }],
      }),
    );
    expect(energy.findings).toEqual([]);
  });

  it('leaves out discounts that end while the fixed charges do not rise', () => {
    const lines: Line[] = [{ kind: 'base_fee', description: 'Pacote', amountCents: 3999 }];
    const invoice = { id: 'i2', issueDate: '2026-10-01', totalCents: 3999 };
    expect(auditInvoice(input({ invoice, lines })).findings).toEqual([
      { kind: 'fee_changed', description: 'Pacote', beforeCents: 4999, afterCents: 3999 },
    ]);
  });

  it('does not count usage (calls, roaming) as a new charge', () => {
    const lines: Line[] = [
      ...telecomBefore,
      { kind: 'usage', description: 'Telemóvel', amountCents: 453 },
    ];
    const invoice = { id: 'i2', issueDate: '2026-10-01', totalCents: 4752 };
    expect(auditInvoice(input({ invoice, lines })).findings).toEqual([]);
  });

  it('compares unit prices, not amounts, and ignores taxes', () => {
    const energy = (price: string, quantity: number, tax: string): Line[] => [
      {
        kind: 'energy',
        description: 'Energia Fora de Vazio',
        period: 'off_empty',
        amountCents: Math.round(Number(price) * quantity * 100),
        quantity,
        unit: 'kWh',
        unitPrice: price,
      },
      {
        kind: 'power',
        description: 'Potência',
        amountCents: 900,
        quantity: 30,
        unit: 'day',
        unitPrice: '0.3',
      },
      { kind: 'tax', description: 'IEC', amountCents: 100, quantity, unit: 'kWh', unitPrice: tax },
    ];
    const same = auditInvoice(
      input({
        contract: { sector: 'electricity' },
        previousLines: energy('0.1650', 200, '0.001'),
        lines: energy('0.1650', 260, '0.002'),
      }),
    );
    expect(same.findings).toEqual([]);

    const up = auditInvoice(
      input({
        contract: { sector: 'electricity' },
        previousLines: energy('0.1650', 200, '0.001'),
        lines: energy('0.1820', 200, '0.001'),
      }),
    );
    expect(up.findings).toEqual([
      {
        kind: 'price_changed',
        description: 'Energia Fora de Vazio',
        unit: 'kWh',
        before: '0.1650',
        after: '0.1820',
      },
    ]);
    expect(up.increased).toBe(true);
    expect(needsAuditAlert(up)).toBe(false);
  });

  it('uses the price in force at the end of the period', () => {
    const line = (unitPrice: string, quantity: number): Line => ({
      kind: 'energy',
      description: 'Energia',
      amountCents: 1000,
      quantity,
      unit: 'kWh',
      unitPrice,
    });
    const audit = auditInvoice(
      input({
        contract: { sector: 'electricity' },
        previousLines: [line('0.15', 100)],
        lines: [line('0.15', 50), line('0.17', 50), line('0.12', -10)],
      }),
    );
    expect(audit.findings).toMatchObject([
      { kind: 'price_changed', before: '0.15', after: '0.17' },
    ]);
  });

  it('flags recurring charges above the contracted monthly price', () => {
    const audit = auditInvoice(input({ contract: { sector: 'telecom', monthlyPriceCents: 3999 } }));
    expect(audit.findings).toEqual([
      { kind: 'above_contracted', contractedCents: 3999, chargedCents: 4299 },
    ]);
    expect(audit.increased).toBe(true);
    expect(
      auditInvoice(input({ contract: { sector: 'telecom', monthlyPriceCents: 4299 } })).findings,
    ).toEqual([]);
    // Not for energy: the price depends on consumption.
    expect(
      auditInvoice(input({ contract: { sector: 'electricity', monthlyPriceCents: 1 } })).findings,
    ).toEqual([]);
  });

  it('uses the total when there are no lines, and reports that there is no detail', () => {
    const audit = auditInvoice(
      input({
        contract: { sector: 'other', monthlyPriceCents: 2000 },
        invoice: { id: 'i2', issueDate: '2026-10-01', totalCents: 2500 },
        lines: [],
        previousLines: [],
      }),
    );
    expect(audit.detailed).toBe(false);
    expect(audit.findings).toEqual([
      { kind: 'above_contracted', contractedCents: 2000, chargedCents: 2500 },
    ]);
  });

  it('knows whether the invoice is from the loyalty period', () => {
    const during = { sector: 'telecom' as const, loyaltyEndDate: '2026-10-01' };
    expect(auditInvoice(input({ contract: during })).duringLoyalty).toBe(true);
    const after = { sector: 'telecom' as const, loyaltyEndDate: '2026-09-30' };
    expect(auditInvoice(input({ contract: after })).duringLoyalty).toBe(false);
    expect(auditInvoice(input()).duringLoyalty).toBe(false);
  });

  it('compares nothing without a previous invoice', () => {
    const audit = auditInvoice(input({ previous: undefined, previousLines: undefined }));
    expect(audit.findings).toEqual([]);
    expect(audit.previousInvoiceId).toBeUndefined();
  });
});

describe('recurringCents', () => {
  it('adds fixed charges and discounts, scaling net lines to the total with VAT', () => {
    expect(recurringCents({ totalCents: 4299 }, telecomBefore)).toBe(4299);
    const net: Line[] = [
      { kind: 'base_fee', description: 'Pacote', amountCents: 4000 },
      { kind: 'usage', description: 'Chamadas', amountCents: 1000 },
    ];
    expect(recurringCents({ totalCents: 6150 }, net)).toBe(4920);
    expect(
      recurringCents({ totalCents: 100 }, [{ kind: 'usage', description: 'x', amountCents: 100 }]),
    ).toBeNull();
  });
});
