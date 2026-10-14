import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys } from '../../lib/crypto';
import { buildCalendarFile } from './calendar-export';

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
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(async () => {
  await db.delete();
});

const ORIGIN = 'https://app.example';
const NOW = '2026-10-14T12:00:00.000Z';

describe('buildCalendarFile', () => {
  it('returns null when there are no dates', async () => {
    expect(await buildCalendarFile(repos, ORIGIN, '2026-10-14', NOW)).toBeNull();
  });

  it('writes the loyalty end and the payment due date in Portuguese', async () => {
    const contract = await repos.contracts.get('c1');
    await repos.contracts.put({ ...contract!, loyaltyEndDate: '2027-01-31' });
    await repos.invoices.put({
      id: 'i1',
      contractId: 'c1',
      providerId: 'p1',
      fileHash: 'h',
      docType: 'FT',
      issueDate: '2026-10-01',
      dueDate: '2026-10-20',
      totalCents: 4599,
      qrStatus: 'ok',
      validation: 'passed',
      sources: {},
      confidence: {},
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    const file = await buildCalendarFile(repos, ORIGIN, '2026-10-14', NOW);
    expect(file?.count).toBe(2);
    const ics = file!.ics.replace(/\r\n /g, '');
    expect(ics).toContain('SUMMARY:Pagar fatura: Internet\\, NOS (45\\,99');
    expect(ics).toContain('Data-limite de pagamento da fatura de 01-10-2026.');
    expect(ics).toContain('SUMMARY:Fim da fidelização: Internet\\, NOS');
    expect(ics).toContain('URL:https://app.example/app/contratos/c1');
    expect(ics.indexOf('payment-i1')).toBeLessThan(ics.indexOf('loyalty-c1'));
  });
});
