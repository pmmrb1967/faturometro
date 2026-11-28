import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAvailable } from '../ai/session';
import { DEMO_EMAIL, isDemo, isGuest, profilesDb } from '../db/profiles';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb, profileDbName } from '../db/schema';
import { annualUsage } from '../domain/compare';
import { addMonthsTo, monthOf } from '../domain/month';
import { warrantyStatus } from '../domain/warranty';
import { createGuest, listAccountEmails, openGuest } from '../features/auth/accounts';
import { getSettings } from '../features/settings/settings';
import { importMasterKey } from '../lib/crypto';
import { createDemo, removeDemos } from './demo-account';
import { DEMO_MONTHS } from './seed';

// Each demonstration encrypts several hundred records into fake IndexedDB: a few seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

async function clearProfiles() {
  await removeDemos();
  await profilesDb.profiles.clear();
}

async function openDemo(today: string): Promise<{ repos: Repositories; db: ProfileDb }> {
  const { profile, masterKey } = await createDemo(today);
  const db = new ProfileDb(profile.id);
  return { repos: createRepositories(db, masterKey), db };
}

async function databaseExists(name: string): Promise<boolean> {
  return (await Dexie.getDatabaseNames()).includes(name);
}

// Two days far apart: everything counts back from today.
describe.each(['2026-11-28', '2027-03-02'])('the demonstration on %s', (today) => {
  // Made once for these read-only checks.
  let repos: Repositories;
  let db: ProfileDb;
  beforeAll(async () => {
    await clearProfiles();
    ({ repos, db } = await openDemo(today));
  });
  afterAll(() => db.close());

  it('has a contract of each kind, each with its invoices', async () => {
    const contracts = await repos.contracts.list();
    expect(contracts.map((contract) => contract.sector).sort()).toEqual([
      'electricity',
      'gas',
      'insurance',
      'insurance',
      'telecom',
      'transport',
      'water',
    ]);
    for (const contract of contracts) {
      const invoices = await repos.invoices.findBy('contractId', contract.id);
      expect(invoices.length, contract.label).toBeGreaterThan(0);
      for (const invoice of invoices) {
        expect(invoice.issueDate <= today).toBe(true);
        // Nothing two years back: "Início" would compare with a year almost empty.
        expect(monthOf(invoice.issueDate) > addMonthsTo(monthOf(today), -23)).toBe(true);
        expect(Number.isInteger(invoice.totalCents)).toBe(true);
        expect(invoice.totalCents).toBeGreaterThan(0);
      }
    }
    const monthly = contracts.find((contract) => contract.sector === 'telecom')!;
    expect((await repos.invoices.findBy('contractId', monthly.id)).length).toBeGreaterThanOrEqual(
      DEMO_MONTHS,
    );
  });

  it('shows the alerts the app is about', async () => {
    const kinds = new Set((await repos.alerts.list()).map((alert) => alert.kind));
    for (const kind of [
      'loyalty_ending',
      'price_increase',
      'premium_notice',
      'meter_reading',
      'payment_due',
      'warranty_ending',
      'warranty_proof',
    ] as const) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    // One date for the renewal: the letter's notice stands for the renewal alert.
    expect(kinds.has('renewal')).toBe(false);
    // Nothing that would only be noise in an example.
    expect(kinds.has('missing_invoice')).toBe(false);
    expect(kinds.has('estimated_readings')).toBe(false);
  });

  it('has a year of electricity and gas to compare offers with', async () => {
    for (const sector of ['electricity', 'gas'] as const) {
      const contract = (await repos.contracts.findBy('sector', sector))[0]!;
      const usage = annualUsage(
        await repos.invoices.findBy('contractId', contract.id),
        await repos.readings.findBy('contractId', contract.id),
        today,
      );
      expect(usage?.total, sector).toBeGreaterThan(1000);
    }
  });

  it('has expenses, income and purchases this month, and warranties', async () => {
    const month = monthOf(today);
    expect((await repos.expenses.list()).length).toBeGreaterThan(0);
    expect((await repos.incomes.list()).length).toBeGreaterThan(0);
    expect((await repos.categories.list()).length).toBeGreaterThan(0);
    const transactions = await repos.transactions.list();
    expect(transactions.some((item) => item.date.startsWith(month))).toBe(true);
    expect(transactions.some((item) => item.toPay)).toBe(true);
    expect(transactions.every((item) => item.toPay || item.date <= today)).toBe(true);

    const warranties = await repos.warranties.list();
    expect(warranties.map((warranty) => warrantyStatus(warranty, today).state).sort()).toEqual([
      'active',
      'active',
      'ending',
    ]);
    const withFile = warranties.find((warranty) => warranty.fileHash)!;
    const file = await repos.documents.getByFileHash(withFile.fileHash!);
    expect(new TextDecoder().decode(file?.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('turns the AI off and needs no backup', async () => {
    const settings = await getSettings(repos);
    expect(settings.aiMode).toBe('none');
    expect(settings.lastBackupAt).toBe(today);
  });
});

describe('the demonstration profile', () => {
  beforeEach(clearProfiles);

  it('is a guest of its own, never the guest nor an account', async () => {
    const guest = await createGuest();
    const demo = await createDemo('2026-11-28');
    expect(demo.profile.email).toBe(DEMO_EMAIL);
    expect(isDemo(demo.profile)).toBe(true);
    expect(isGuest(demo.profile)).toBe(true);
    expect((await openGuest())?.profile.id).toBe(guest.profile.id);
    expect(await listAccountEmails()).toEqual([]);
    // Its key is stored, like the guest's: it opens without a password.
    await expect(importMasterKey(demo.profile.guestKey!)).resolves.toBeDefined();
  });

  it('never uses the AI, not even the free one', async () => {
    const { profile } = await createDemo('2026-11-28');
    expect(aiAvailable(profile, { aiMode: 'free' })).toBe(false);
    expect(aiAvailable({ ...profile, demo: undefined }, { aiMode: 'free' })).toBe(true);
  });

  it('starts again each time: the earlier one and its data are deleted', async () => {
    const first = await createDemo('2026-11-28');
    const second = await createDemo('2026-11-28');
    expect(await profilesDb.profiles.where('email').equals(DEMO_EMAIL).count()).toBe(1);
    expect(await profilesDb.profiles.get(first.profile.id)).toBeUndefined();
    expect(await databaseExists(profileDbName(first.profile.id))).toBe(false);
    expect(await databaseExists(profileDbName(second.profile.id))).toBe(true);
  });

  it('leaves a recent one alone when clearing old ones', async () => {
    const { profile } = await createDemo('2026-11-28');
    await removeDemos(new Date(Date.parse(profile.createdAt) - 60_000).toISOString());
    expect(await profilesDb.profiles.get(profile.id)).toBeDefined();
    await removeDemos(new Date(Date.parse(profile.createdAt) + 1).toISOString());
    expect(await profilesDb.profiles.get(profile.id)).toBeUndefined();
    expect(await databaseExists(profileDbName(profile.id))).toBe(false);
  });

  it('keeps the guest and its data when it goes', async () => {
    const guest = await createGuest();
    await createDemo('2026-11-28');
    await removeDemos();
    expect((await openGuest())?.profile.id).toBe(guest.profile.id);
  });
});
