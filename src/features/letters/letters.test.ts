import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { Invoice } from '../../domain/types';
import { createAccountKeys } from '../../lib/crypto';
import { refreshAlerts } from '../alerts/refresh';
import { buildLetter, letterKinds, loadLetterData, type LetterData } from './letters';

const TODAY = '2026-10-14';

function data(overrides: Partial<LetterData> = {}): LetterData {
  return {
    providerName: 'NOS',
    contract: { sector: 'telecom', customerNumber: '123456' },
    ...overrides,
  };
}

describe('letterKinds', () => {
  it('offers the estimated-readings letter only for metered services', () => {
    expect(letterKinds({ sector: 'telecom' })).not.toContain('estimated_reading');
    expect(letterKinds({ sector: 'electricity' })).toContain('estimated_reading');
  });
});

describe('buildLetter', () => {
  it('fills what the app knows and leaves placeholders for the rest', () => {
    const { subject, text } = buildLetter('renegotiate', data(), TODAY);
    expect(subject).toBe('Pedido de revisão do preço');
    expect(text).toContain('[NOME]\n[MORADA]\nNIF: [NIF]\n\nNOS\n14-10-2026');
    expect(text).toContain('Assunto: Pedido de revisão do preço');
    expect(text).toContain('N.º de cliente: 123456');
    expect(text).not.toContain('CPE/CUI');
    expect(text).toContain('Sou vosso cliente de serviços de telecomunicações.');
    expect(text.endsWith('Com os melhores cumprimentos,\n[NOME]')).toBe(true);
  });

  it('uses the NIF, supply point, average, loyalty and cheaper offer', () => {
    const { text } = buildLetter(
      'renegotiate',
      data({
        ownNif: '999999990',
        contract: {
          sector: 'electricity',
          supplyPointId: 'PT0002000000000000AA',
          tariffName: 'Casa',
          loyaltyEndDate: '2026-09-30',
        },
        average: { cents: 5250, count: 3 },
        cheaperOffer: { name: 'X — Y', yearlySavingCents: 8000 },
      }),
      TODAY,
    );
    expect(text).toContain('NIF: 999999990');
    expect(text).toContain('N.º de cliente: [N.º DE CLIENTE]\nCPE/CUI: PT0002000000000000AA');
    expect(text).toContain('com o tarifário Casa.');
    expect(text).toMatch(/Nas últimas 3 faturas paguei em média 52,50\s€ por mês\./);
    expect(text).toContain('O meu período de fidelização terminou a 30-09-2026.');
    expect(text).toMatch(/oferta mais económica \(X — Y\), com uma poupança estimada de 80,00\s€/);
  });

  it('describes the price increase from the alert', () => {
    const increase = {
      issueDate: '2026-10-01',
      totalCents: 4999,
      reason: 'base_fee',
      before: 3999,
      after: 4499,
      increasePct: 12.5,
    };
    expect(buildLetter('price_increase', data({ increase }), TODAY).text).toMatch(
      /Na fatura de 01-10-2026, a mensalidade passou de 39,99\s€ para 44,99\s€\./,
    );
    const unit = { ...increase, reason: 'unit_price' };
    expect(buildLetter('price_increase', data({ increase: unit }), TODAY).text).toContain(
      'o preço da energia subiu 12,5 %',
    );
    expect(buildLetter('price_increase', data(), TODAY).text).toContain(
      'Na fatura de [DATA], no valor de [VALOR]',
    );
  });

  it('lists what the audit found in the increase letter', () => {
    const text = buildLetter(
      'price_increase',
      data({ auditDetails: ['Pacote: passou de 49,99 € para 52,99 €.'] }),
      TODAY,
    ).text;
    expect(text).toContain(
      'Comparando com a fatura anterior:\n- Pacote: passou de 49,99 € para 52,99 €.',
    );
  });

  it('asks for equipment instructions only when cancelling telecom', () => {
    const telecom = buildLetter(
      'cancel',
      data({ contract: { sector: 'telecom', loyaltyEndDate: '2027-01-31' } }),
      TODAY,
    ).text;
    expect(telecom).toContain('com efeitos a partir de [DATA DE FIM]');
    expect(telecom).toContain('O meu período de fidelização termina a 31-01-2027.');
    expect(telecom).toContain('devolver os equipamentos');
    expect(
      buildLetter('cancel', data({ contract: { sector: 'water' } }), TODAY).text,
    ).not.toContain('equipamentos');
  });

  it('counts the estimated readings when known', () => {
    const text = buildLetter(
      'estimated_reading',
      data({
        contract: { sector: 'gas' },
        estimatedCount: 3,
        latestInvoice: { issueDate: '2026-10-01', totalCents: 3000 },
      }),
      TODAY,
    ).text;
    expect(text).toContain('As últimas 3 faturas foram emitidas com leituras estimadas');
    expect(text).toContain('A leitura atual do contador é [LEITURA], em [DATA DA LEITURA].');
  });
});

describe('loadLetterData', () => {
  let db: ProfileDb;
  let repos: Repositories;

  beforeEach(async () => {
    db = new ProfileDb(crypto.randomUUID());
    repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
    await repos.providers.put({ id: 'p1', nif: '123456789', name: 'NOS', sectors: ['telecom'] });
    await repos.contracts.put({
      id: 'c1',
      providerId: 'p1',
      sector: 'telecom',
      label: 'Internet',
      customerNumber: '123456',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  function invoice(id: string, issueDate: string, totalCents: number): Invoice {
    return {
      id,
      updatedAt: `${issueDate}T10:00:00.000Z`,
      contractId: 'c1',
      providerId: 'p1',
      fileHash: id,
      docType: 'FT',
      issueDate,
      totalCents,
      qrStatus: 'ok',
      validation: 'passed',
      sources: {},
      confidence: {},
      createdAt: `${issueDate}T10:00:00.000Z`,
    };
  }

  it('reads the provider, average, latest invoice and price increase', async () => {
    for (const [id, date, total] of [
      ['i1', '2026-06-01', 4000],
      ['i2', '2026-07-01', 4000],
      ['i3', '2026-08-01', 4000],
      ['i4', '2026-09-01', 6000],
    ] as const) {
      await repos.invoices.put(invoice(id, date, total));
    }
    await refreshAlerts(repos, '2026-09-05');
    const contract = await repos.contracts.get('c1');
    const loaded = await loadLetterData(repos, contract!);
    expect(loaded.providerName).toBe('NOS');
    expect(loaded.average).toEqual({ cents: Math.round(14000 / 3), count: 3 });
    expect(loaded.latestInvoice).toEqual({ issueDate: '2026-09-01', totalCents: 6000 });
    expect(loaded.increase).toMatchObject({
      issueDate: '2026-09-01',
      reason: 'total',
      after: 6000,
    });
    expect(loaded.ownNif).toBeUndefined();
  });
});
