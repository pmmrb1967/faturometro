import { describe, expect, it } from 'vitest';
import config from '../data/comescolha.json';
import { checkIsStale, comEscolhaConfigSchema, comEscolhaUrl, monthlyAverage } from './comescolha';

const parsed = comEscolhaConfigSchema.parse(config);

function query(url: string | null): URLSearchParams {
  if (!url) throw new Error('no url');
  return new URL(url).searchParams;
}

describe('comEscolhaUrl', () => {
  it('the shipped configuration is valid', () => {
    expect(comEscolhaConfigSchema.safeParse(config).success).toBe(true);
  });

  it('two or more services use the combined search, one parameter per service', () => {
    const url = comEscolhaUrl(parsed, { services: ['mobile', 'internet', 'tv'] });
    expect(url).toMatch(
      /^https:\/\/www\.anacom\.pt\/tarifarios\/CombinadosResultadosConsulta\.do\?/,
    );
    const params = query(url);
    const { serviceIds } = parsed.combined;
    expect(params.getAll(parsed.combined.serviceParam)).toEqual([
      serviceIds.internet,
      serviceIds.tv,
      serviceIds.mobile,
    ]);
    for (const [name, value] of Object.entries(parsed.combined.fixed)) {
      expect(params.get(name)).toBe(value);
    }
  });

  it('one service uses its own search', () => {
    expect(comEscolhaUrl(parsed, { services: ['mobile'] })).toContain(parsed.single.mobile.path);
    expect(comEscolhaUrl(parsed, { services: ['internet'] })).toContain(
      parsed.single.internet.path,
    );
  });

  it('limits to what the user pays, in whole euros with no comma', () => {
    const params = query(
      comEscolhaUrl(parsed, { services: ['internet', 'tv'], monthlyLimitCents: 3990 }),
    );
    expect(params.get(parsed.combined.limitParam)).toBe('40');
  });

  it('sends the postal prefix only when valid and only where the search takes it', () => {
    const postal = parsed.combined.postalParam ?? '';
    expect(
      query(comEscolhaUrl(parsed, { services: ['internet', 'tv'], postalPrefix: '4000' })).get(
        postal,
      ),
    ).toBe('4000');
    expect(
      query(comEscolhaUrl(parsed, { services: ['internet', 'tv'], postalPrefix: '40' })).has(
        postal,
      ),
    ).toBe(false);
    const mobile = comEscolhaUrl(parsed, { services: ['mobile'], postalPrefix: '4000' });
    expect(mobile).not.toContain('4000');
  });

  it('without services there is nothing to search', () => {
    expect(comEscolhaUrl(parsed, { services: [] })).toBeNull();
  });
});

describe('monthlyAverage', () => {
  it('averages the latest three invoices, leaving out credit notes', () => {
    expect(
      monthlyAverage([
        { issueDate: '2026-01-05', totalCents: 9999 },
        { issueDate: '2026-02-05', totalCents: 4000 },
        { issueDate: '2026-03-05', totalCents: -500 },
        { issueDate: '2026-04-05', totalCents: 4100 },
        { issueDate: '2026-05-05', totalCents: 4201 },
      ]),
    ).toEqual({ cents: 4100, count: 3 });
  });

  it('is null without invoices', () => {
    expect(monthlyAverage([])).toBeNull();
  });
});

describe('checkIsStale', () => {
  it('reminds after two weeks without a passing check', () => {
    expect(checkIsStale('2026-10-14', '2026-10-28')).toBe(false);
    expect(checkIsStale('2026-10-14', '2026-10-29')).toBe(true);
    expect(checkIsStale('not a date', '2026-10-29')).toBe(true);
  });
});
