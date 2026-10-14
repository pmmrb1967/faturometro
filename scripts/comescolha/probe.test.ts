import { describe, expect, it } from 'vitest';
import config from '../../src/data/comescolha.json';
import { comEscolhaConfigSchema } from '../../src/domain/comescolha';
import { probe } from './probe';

const parsed = comEscolhaConfigSchema.parse(config);

/** A fake COM.escolha: 100 results, fewer for each filter it applies. */
function site(ignored: string[] = []) {
  return async (url: string) => {
    const params = new URL(url).searchParams;
    let count = 100;
    const applies = (name: string) => params.has(name) && !ignored.includes(name);
    if (applies('limiteMensal')) count = 0;
    if (applies('codigoPostalPrefixo')) count -= 70;
    if (applies('idServico') && params.getAll('idServico').length < 3) count += 4;
    return count;
  };
}

describe('probe', () => {
  it('passes when every filter changes the results', async () => {
    expect(await probe(parsed, site())).toEqual([]);
  });

  it('reports a filter that is ignored', async () => {
    expect(await probe(parsed, site(['codigoPostalPrefixo']))).toEqual([
      'combined: postal code ignored (100 of 100)',
    ]);
    const limit = await probe(parsed, site(['limiteMensal']));
    expect(limit).toHaveLength(5);
    expect(limit[0]).toBe('combined: monthly limit ignored (100 of 100)');
  });

  it('reports a search with no results', async () => {
    expect(await probe(parsed, async () => null)).toContain('combined: no results without filters');
  });
});
