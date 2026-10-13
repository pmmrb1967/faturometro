import { describe, expect, it } from 'vitest';
import { dataDateFromName, normalize, parseCsv } from './normalize';

// Synthetic rows in the ERSE format (column names as in the real CSV).
const CONDITIONS = [
  '\uFEFFCOM;COD_Proposta;NomeProposta;Segmento;TipoContagem;Fornecimento;DuracaoContrato;Data ini;Data fim;Filtrofaturacao;FiltroPagamento;FiltroFidelização;FiltroRenovavel_ELE;FiltroRestrições;FiltroPrecosIndex_ELE;FiltroServicosAdic;CustoServicos_c/IVA (€/ano);ReembFixo (€/ano);ReembTF_ELE (%);ReembTW_ELE (%);ReembW_ELE (€/kWh);DescontNovoCliente_c/IVA (€/ano);Desc. TF_ELE (%) - Novo Cliente;Desc. TW_ELE (%) - Novo Cliente;Desc. W_ELE (€/kWh) - Novo Cliente;LinkOfertaCom;TxTFidelização',
  'ACME;ACME_01;Oferta Teste;Dom;12;ELE;12;01/10/2026;31/12/2026;10;100;N;S;N;N;N;;12,5;10;;;;;;;https://example.com/oferta;Não tem fidelização',
  'ACME;ACME_GN;Gás Teste;Dom;;GN;12;01/10/2026;31/12/2026;10;100;N;N;N;N;N;;;;;;;;;;;',
  'ACME;ACME_02;Sem preços;Dom;1;ELE;12;01/10/2026;31/12/2026;10;100;S;N;N;N;N;;;;;;;;;;;',
].join('\r\n');

const PRICES = [
  '\uFEFFCOM;Pot_Cont;Escalao;ORD;COD_Proposta;Contagem;TF;TV|TVFV|TVP;TVV|TVC;TVVz;TFGN;TVGN',
  'ACME;6,9;;;ACME_01;1;0,5636;0,1665;;;;',
  'ACME;6,9;;;ACME_01;2;0,5636;0,2045;0,1143;;;',
  'ACME;3,45;;;ACME_01;1;0,3;0,17;;;;',
  'ACME;;1;;ACME_GN;;;;;;0,12;0,10',
].join('\r\n');

describe('ERSE normalize', () => {
  const file = normalize(parseCsv(CONDITIONS), parseCsv(PRICES), {
    source: '20261013 122404 CSV.zip',
    dataDate: '2026-10-13',
    fetchedAt: '2026-10-13T12:00:00.000Z',
  });

  it('keeps electricity offers that have prices, skipping gas-only ones', () => {
    expect(file.offers.map((offer) => offer.id)).toEqual(['ACME_01']);
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
