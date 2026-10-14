import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys } from '../../lib/crypto';
import { dismissAlert, refreshAlerts } from './refresh';

let db: ProfileDb;
let repos: Repositories;

beforeEach(async () => {
  db = new ProfileDb(crypto.randomUUID());
  repos = createRepositories(db, (await createAccountKeys('x', 1_000)).masterKey);
  await repos.contracts.put({
    id: 'c1',
    providerId: 'p1',
    sector: 'telecom',
    label: 'Internet',
    loyaltyEndDate: '2026-08-01',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(async () => {
  await db.delete();
});

const visible = async () => (await repos.alerts.list()).filter((alert) => !alert.dismissedAt);

describe('refreshAlerts', () => {
  it('stores alerts with a Portuguese message', async () => {
    await refreshAlerts(repos, '2026-07-05');
    const [alert] = await visible();
    expect(alert).toMatchObject({ kind: 'loyalty_ending', contractId: 'c1' });
    expect(alert?.message).toBe(
      'Internet: a fidelização termina a 01-08-2026 (daqui a 27 dias). Bom momento para comparar ou renegociar.',
    );
  });

  it('keeps dismissed alerts dismissed, but alerts again at the next threshold', async () => {
    await refreshAlerts(repos, '2026-07-05');
    const [alert] = await visible();
    await dismissAlert(repos, alert!.id);
    await refreshAlerts(repos, '2026-07-06');
    expect(await visible()).toEqual([]);

    await refreshAlerts(repos, '2026-07-28');
    expect((await visible())[0]?.data).toMatchObject({ threshold: 7 });
  });

  it('removes alerts that are no longer true', async () => {
    await refreshAlerts(repos, '2026-07-05');
    const contract = await repos.contracts.get('c1');
    const withoutLoyalty = { ...contract! };
    delete withoutLoyalty.loyaltyEndDate;
    await repos.contracts.put(withoutLoyalty);
    await refreshAlerts(repos, '2026-07-05');
    expect(await visible()).toEqual([]);
  });
});

describe('invoice audit message', () => {
  it('lists what changed', async () => {
    const { alertMessage } = await import('./refresh');
    expect(
      alertMessage(
        {
          kind: 'invoice_audit',
          data: { issueDate: '2026-10-01', kinds: ['discount_ended', 'new_charge'] },
        },
        { label: 'Internet' } as never,
      ),
    ).toBe(
      'Internet: na fatura de 01-10-2026, deixou de aparecer um desconto, há uma cobrança nova. Vê o detalhe na página do contrato.',
    );
  });
});
