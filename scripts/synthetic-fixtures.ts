/**
 * Writes the public synthetic fixtures (fixtures/<providerId>/synthetic-*.json).
 *
 *   pnpm exec tsx scripts/synthetic-fixtures.ts
 *
 * Layout (labels and positions) follows each provider's template; every value
 * (names, numbers, dates, amounts, consumption) is invented. Real invoices only
 * ever produce private fixtures (fixtures/private, git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Item = [str: string, x: number, y: number];

function page(number: number, items: Item[]) {
  return {
    page: number,
    width: 595,
    height: 842,
    items: items.map(([str, x, y]) => ({
      str,
      x,
      y,
      width: Math.round(str.length * 4.6 * 100) / 100,
      height: 8,
      fontName: 'g_d0_f1',
    })),
  };
}

function write(
  providerId: string,
  name: string,
  qrs: { text: string; page: number }[],
  pages: unknown[],
) {
  const dir = resolve('fixtures', providerId);
  mkdirSync(dir, { recursive: true });
  const fixture = { schemaVersion: 2, parserId: providerId, synthetic: true, qrs, pages };
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`✔ fixtures/${providerId}/${name}.json`);
}

// Repsol: bi-hourly electricity, 4,6 kVA, 200 kWh in 31 days. VAT per ERSE rules (docs/electricity-vat.md):
// energy (≤ 207 kWh) and CAV at 6 % = 2,21 €; power and DGEG at 23 % = 1,44 €. Net 43,12 € → 46,77 €.
write(
  'repsol',
  'synthetic-1',
  [
    {
      page: 2,
      text: 'A:500246963*B:999999990*C:PT*D:FT*E:N*F:20260605*G:FAC 1000000001/2000000001*H:ABCD1234-2000000001*I1:PT*I3:36.85*I4:2.21*I7:6.27*I8:1.44*N:3.65*O:46.77*Q:abcd*R:0000',
    },
  ],
  [
    page(1, [
      ['Fatura/Recibo', 496, 39],
      ['Cliente / Conta:', 31, 156],
      ['12345 / 001', 92, 156],
      ['Resumo de faturação', 31, 216],
      ['Repsol Portuguesa, Lda. Exemplo sintético', 10, 543],
      ['Débito a partir de', 51, 768],
      ['15 jul 2026', 51, 780],
    ]),
    page(2, [
      ['Fatura', 203, 33],
      ['Tipo de Cliente', 327, 33],
      ['Tipo de Leitura', 450, 33],
      ['FAC 1000000001/2000000001', 203, 42],
      ['Domésticos', 327, 42],
      ['Empresa', 450, 42],
      ['Data Fim Período', 203, 54],
      ['Tarifa', 327, 54],
      ['2026-05-31', 203, 63],
      ['Tarifa Bi-horária Exemplo', 327, 63],
      ['Resumo', 37, 75],
      ['Período Faturação: 2026-05-01 ~ 2026-05-31', 436, 75],
      ['Contador Nº', 39, 84],
      ['Potência', 112, 84],
      ['Tipo de Consumo', 174, 84],
      ['Data', 274, 84],
      ['Leitura', 352, 84],
      ['Fator Multipl.', 410, 84],
      ['Consumo', 469, 84],
      ['000000000000001', 39, 93],
      ['4,60kVA', 112, 93],
      ['Vazio', 174, 93],
      ['2026-05-31', 274, 93],
      ['1.200', 352, 93],
      ['1,00000', 410, 93],
      ['Real', 469, 93],
      ['60,00', 520, 93],
      ['kWh', 540, 93],
      ['Fora de Vazio', 174, 108],
      ['2026-05-31', 274, 108],
      ['2.400', 352, 108],
      ['1,00000', 410, 108],
      ['Real', 469, 108],
      ['140,00', 520, 108],
      ['kWh', 540, 108],
      ['Descrição', 39, 153],
      ['Explicação de valores', 285, 153],
      ['Valor(€)', 423, 153],
      ['IVA', 450, 153],
      ['Eletricidade', 53, 168],
      ['Energia Vazio', 53, 174],
      ['Real', 200, 174],
      ['01/05 a 31/05', 234, 174],
      ['60 kWh x 0,100000 €/kWh', 285, 174],
      ['6,00', 435, 174],
      ['Energia Fora de Vazio', 53, 183],
      ['Real', 200, 183],
      ['01/05 a 31/05', 234, 183],
      ['140 kWh x 0,200000 €/kWh', 285, 183],
      ['28,00', 432, 183],
      ['Potência Contratada (4.60 kVA)', 53, 192],
      ['01/05 a 31/05', 234, 192],
      ['31 dias x 0,200000 €/dia', 285, 192],
      ['6,20', 435, 192],
      ['Taxas e Impostos', 53, 210],
      ['Contribuição Audiovisual', 53, 216],
      ['01/05 a 31/05', 234, 216],
      ['1,000000 meses x 2,850000 €/mês', 285, 216],
      ['2,85', 435, 216],
      ['Taxa Exploração DGEG (DL-4/93)', 53, 225],
      ['01/05 a 31/05', 234, 225],
      ['0,07', 435, 225],
      ['(c) IVA 23%', 53, 234],
      ['01/05 a 31/05', 234, 234],
      ['6,2700 € x 23,00%', 285, 234],
      ['1,44', 435, 234],
      ['(b) IVA 6%', 53, 243],
      ['01/05 a 31/05', 234, 243],
      ['36,8500 € x 6,00%', 285, 243],
      ['2,21', 435, 243],
      ['Total sem IVA', 41, 251],
      ['43,12€', 432, 251],
      ['TOTAL', 40, 263],
      ['46,77€', 430, 263],
    ]),
    page(3, [
      ['Dados da Conta', 31, 33],
      ['Oferta, tarifa ou plano', 61, 81],
      ['Tarifa Bi-horária Exemplo', 61, 93],
      ['Potência: 4,60kVA', 211, 93],
      ['CPE (Código Ponto Entrega)', 61, 102],
      ['PT 0000 0000 0000 0000 XX', 61, 111],
    ]),
  ],
);

// NOS: package with a discount and mobile usage. Total 35,00 € with VAT (23 %: 6,54 €).
write(
  'nos',
  'synthetic-1',
  [
    {
      page: 1,
      text: 'A:502604751*B:999999990*C:PT*D:FT*E:N*F:20260605*G:FT 100000/1000001*H:ABCD1234-1000001*I1:PT*I7:28.46*I8:6.54*N:6.54*O:35.00*Q:0000*R:0',
    },
  ],
  [
    page(1, [
      ['N.º cliente', 310, 24],
      ['N.º contribuinte', 409, 24],
      ['C100000001', 310, 33],
      ['999999990', 409, 33],
      ['Fatura n.º', 310, 51],
      ['Data da fatura', 409, 51],
      ['Período de faturação', 491, 51],
      ['nos.pt', 272, 54],
      ['FT 100000/1000001', 310, 60],
      ['05-06-2026', 409, 60],
      ['Junho de 2026', 491, 60],
      ['Nesta fatura', 58, 231],
      ['Qtd', 232, 234],
      ['IVA', 254, 234],
      ['Serviço', 296, 234],
      ['Desconto', 347, 234],
      ['Total', 423, 234],
      ['c/ IVA', 303, 243],
      ['c/ IVA', 362, 243],
      ['c/ IVA', 422, 243],
      ['Pacotes', 75, 258],
      ['1', 236, 258],
      ['23%', 254, 258],
      ['€40,00', 299, 258],
      ['€10,00', 363, 258],
      ['€30,00', 418, 258],
      ['Telemóvel', 75, 282],
      ['1', 236, 282],
      ['23%', 254, 282],
      ['€5,00', 304, 282],
      ['€0,00', 363, 282],
      ['€5,00', 423, 282],
      ['IVA (23%)', 58, 327],
      ['€6,54', 244, 327],
      ['Valor desta fatura com IVA', 58, 345],
      ['€35,00', 419, 345],
      ['Total a pagar até 30 jun 2026', 63, 369],
      ['NOS Comunicações, S.A. Exemplo sintético', 14, 594],
    ]),
    page(2, [
      ['Detalhe desta fatura', 58, 144],
      ['Pacotes', 83, 165],
      ['Informação sobre o seu pacote', 324, 165],
      ['Pacote Exemplo', 69, 198],
      ['05 jun - 04 jul', 202, 198],
      ['€40,000', 272, 198],
      ['Período de fidelização', 63, 270],
      ['Data fim', 202, 321],
      ['Valor com IVA', 255, 321],
      ['Não aplicável', 202, 336],
    ]),
  ],
);
