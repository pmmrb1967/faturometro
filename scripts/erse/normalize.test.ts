import { describe, expect, it } from 'vitest';
import { OFFERS_SCHEMA_VERSION, OFFERS_URL } from '../../src/domain/erse';
import { dataDateFromName, isUpToDate, normalize, parseCsv } from './normalize';

// Synthetic rows in the ERSE format (column names as in the real CSV).
const CONDITIONS = [
  '﻿COM;COD_Proposta;NomeProposta;Segmento;TipoContagem;Fornecimento;DuracaoContrato;Data ini;Data fim;Filtrofaturacao;FiltroPagamento;FiltroFidelização;FiltroRenovavel_ELE;FiltroRestrições;FiltroPrecosIndex_ELE;FiltroServicosAdic;CustoServicos_c/IVA (€/ano);ReembFixo (€/ano);ReembTF_ELE (%);ReembTW_ELE (%);ReembW_ELE (€/kWh);DescontNovoCliente_c/IVA (€/ano);Desc. TF_ELE (%) - Novo Cliente;Desc. TW_ELE (%) - Novo Cliente;Desc. W_ELE (€/kWh) - Novo Cliente;ReembTF_GN (%);ReembTW_GN (%);ReembW_GN (€/kWh);Desc. TF_GN (%) - Novo Cliente;Desc. TW_GN (%) - Novo Cliente;Desc. W_GN (€/kWh) - Novo Cliente;LinkOfertaCom;TxTFidelização',
  'ACME;ACME_01;Oferta Teste;Dom;12;ELE;12;01/10/2026;31/12/2026;10;100;N;S;N;N;N;;12,5;10;;;;;;;;;;;;;https://example.com/oferta;Não tem fidelização',
  'ACME;ACME_GN;Gás Teste;Dom;;GN;12;01/10/2026;31/12/2026;10;100;N;N;N;N;N;;;;;;;;;;5;;;2;;;;',
  'ACME;ACME_DUAL;Luz e Gás;Dom;1;DUAL;12;01/10/2026;31/12/2026;10;100;N;N;N;N;N;;;;;;;;;;;;0,01;;;;;',
  'CUR;CURLIS;Tarifa regulada Lisboa;Dom;;GN;12;01/10/2026;31/12/2026;10;100;N;N;N;N;N;;;;;;;;;;;;;;;;;',
  'ACME;ACME_02;Sem preços;Dom;1;ELE;12;01/10/2026;31/12/2026;10;100;S;N;N;N;N;;;;;;;;;;;;;;;;;',
].join('\r\n');

const PRICES = [
  '﻿COM;Pot_Cont;Escalao;ORD;COD_Proposta;Contagem;TF;TV|TVFV|TVP;TVV|TVC;TVVz;TFGN;TVGN',
  'ACME;6,9;;;ACME_01;1;0,5636;0,1665;;;;',
  'ACME;6,9;;;ACME_01;2;0,5636;0,2045;0,1143;;;',
  'ACME;3,45;;;ACME_01;1;0,3;0,17;;;;',
  'ACME;;1;;ACME_GN;;;;;;0,12;0,10',
  'ACME;;2;;ACME_GN;;;;;;0,15;0,09',
  'ACME;6,9;;;ACME_DUAL;1;0,55;0,16;;;;',
  'ACME;;1;;ACME_DUAL;;;;;;0,11;0,095',
  'CUR;;1;LIS;CURLIS;;;;;;0,09;0,07',
  // Regulated tariff with prices but no conditions row (as the ERSE publishes most of them).
  'CUR;;1;SET;CURSET;;;;;;0,085;0,072',
].join('\r\n');

describe('ERSE normalize', () => {
  const file = normalize(parseCsv(CONDITIONS), parseCsv(PRICES), {
    source: '20261013 122404 CSV.zip',
    dataDate: '2026-10-13',
    fetchedAt: '2026-10-13T12:00:00.000Z',
  });

  it('keeps electricity, gas and dual offers that have prices; regulated ones apart', () => {
    expect(file.offers.map((offer) => offer.id)).toEqual(['ACME_01', 'ACME_GN', 'ACME_DUAL']);
  });

  it('maps gas prices by escalão and the gas discounts', () => {
    const gas = file.offers.find((offer) => offer.id === 'ACME_GN');
    expect(gas?.supply).toBe('GN');
    expect(gas?.prices).toEqual({});
    expect(gas?.gasPrices).toEqual({
      '1': { fixedPerDay: 0.12, perKwh: 0.1 },
      '2': { fixedPerDay: 0.15, perKwh: 0.09 },
    });
    expect(gas?.gasDiscounts).toEqual({ fixedTermPct: 5, energyPct: 0, energyPerKwh: 0 });
    expect(gas?.gasNewClientDiscounts).toEqual({ fixedTermPct: 2, energyPct: 0, energyPerKwh: 0 });
  });

  it('keeps both parts of a dual offer', () => {
    const dual = file.offers.find((offer) => offer.id === 'ACME_DUAL');
    expect(dual?.prices).toEqual({ '6.9': { '1': { fixedPerDay: 0.55, simple: 0.16 } } });
    expect(dual?.gasPrices).toEqual({ '1': { fixedPerDay: 0.11, perKwh: 0.095 } });
    expect(dual?.gasDiscounts.energyPerKwh).toBe(0.01);
  });

  it('puts the regulated gas tariffs by distribution operator', () => {
    expect(file.regulatedGas).toEqual({
      LIS: {
        offerId: 'CURLIS',
        name: 'Tarifa regulada Lisboa',
        prices: { '1': { fixedPerDay: 0.09, perKwh: 0.07 } },
      },
      SET: {
        offerId: 'CURSET',
        name: 'CURSET',
        prices: { '1': { fixedPerDay: 0.085, perKwh: 0.072 } },
      },
    });
    expect(file.schemaVersion).toBe(2);
  });

  it('asks for the file by format version, so a cached older file is not used', () => {
    expect(OFFERS_URL).toBe(`/data/erse-offers.json?v=${OFFERS_SCHEMA_VERSION}`);
    expect(file.schemaVersion).toBe(OFFERS_SCHEMA_VERSION);
  });

  it('rewrites a file of an older format even with the same ZIP', () => {
    expect(isUpToDate({ source: 'a.zip', schemaVersion: 2 }, 'a.zip')).toBe(true);
    expect(isUpToDate({ source: 'a.zip', schemaVersion: 1 }, 'a.zip')).toBe(false);
    expect(isUpToDate({ source: 'b.zip', schemaVersion: 2 }, 'a.zip')).toBe(false);
  });

  it('maps prices by power and cycle (simple / bi-hourly columns)', () => {
    expect(file.offers[0]?.prices).toEqual({
      '6.9': {
        '1': { fixedPerDay: 0.5636, simple: 0.1665 },
        '2': { fixedPerDay: 0.5636, offEmpty: 0.2045, empty: 0.1143 },
      },
      '3.45': { '1': { fixedPerDay: 0.3, simple: 0.17 } },
    });
  });

  it('decodes conditions, filters and discounts', () => {
    expect(file.offers[0]).toMatchObject({
      supplier: 'ACME',
      segment: 'Dom',
      durationMonths: 12,
      validFrom: '2026-10-01',
      validTo: '2026-12-31',
      loyalty: false,
      renewable: true,
      payment: { directDebit: true, multibanco: false, cash: false },
      billing: { electronic: true, paper: false },
      discounts: { fixedPerYear: 12.5, fixedTermPct: 10, energyPct: 0, energyPerKwh: 0 },
      links: { offer: 'https://example.com/oferta' },
      texts: { loyalty: 'Não tem fidelização' },
    });
  });

  it('fails loudly when the format changes', () => {
    const broken = CONDITIONS.replace('FiltroPagamento', 'Pagamento');
    expect(() =>
      normalize(parseCsv(broken), parseCsv(PRICES), {
        source: 'x',
        dataDate: '2026-10-13',
        fetchedAt: 'x',
      }),
    ).toThrow(/missing columns FiltroPagamento/);
  });

  it('reads the data date from the file name', () => {
    expect(dataDateFromName('20261013 122404 CSV.zip')).toBe('2026-10-13');
    expect(dataDateFromName('ofertas.zip')).toBeNull();
  });
});
