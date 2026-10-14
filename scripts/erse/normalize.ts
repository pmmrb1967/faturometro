/** Turns the two ERSE CSV tables into the normalized offers file. Pure (tested). */
import { z } from 'zod';
import {
  escalaoSchema,
  offersFileSchema,
  type CyclePrices,
  type GasPrices,
  type Offer,
  type OffersFile,
  type RegulatedGas,
} from '../../src/domain/erse';

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const header = (lines[0] ?? '').split(';');
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

const REQUIRED_PRICE_COLUMNS = [
  'COM',
  'Pot_Cont',
  'Escalao',
  'ORD',
  'COD_Proposta',
  'Contagem',
  'TF',
  'TV|TVFV|TVP',
  'TVV|TVC',
  'TVVz',
  'TFGN',
  'TVGN',
];
const REQUIRED_OFFER_COLUMNS = [
  'COM',
  'COD_Proposta',
  'NomeProposta',
  'Segmento',
  'Fornecimento',
  'DuracaoContrato',
  'Data ini',
  'Data fim',
  'Filtrofaturacao',
  'FiltroPagamento',
  'FiltroFidelização',
  'FiltroRenovavel_ELE',
  'FiltroRestrições',
  'FiltroPrecosIndex_ELE',
  'FiltroServicosAdic',
  'CustoServicos_c/IVA (€/ano)',
  'ReembFixo (€/ano)',
  'ReembTF_ELE (%)',
  'ReembTW_ELE (%)',
  'ReembW_ELE (€/kWh)',
  'DescontNovoCliente_c/IVA (€/ano)',
  'Desc. TF_ELE (%) - Novo Cliente',
  'Desc. TW_ELE (%) - Novo Cliente',
  'Desc. W_ELE (€/kWh) - Novo Cliente',
  'ReembTF_GN (%)',
  'ReembTW_GN (%)',
  'ReembW_GN (€/kWh)',
  'Desc. TF_GN (%) - Novo Cliente',
  'Desc. TW_GN (%) - Novo Cliente',
  'Desc. W_GN (€/kWh) - Novo Cliente',
];

export function assertColumns(
  rows: Record<string, string>[],
  required: string[],
  table: string,
): void {
  const present = new Set(Object.keys(rows[0] ?? {}));
  const missing = required.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(`ERSE ${table}: missing columns ${missing.join(', ')} (format changed?)`);
  }
}

/** "0,1665" → 0.1665; empty, " " or "-" → null. */
function num(text: string | undefined): number | null {
  const clean = (text ?? '').trim();
  if (clean === '' || clean === '-') return null;
  const value = Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

const flag = (text: string | undefined) => (text ?? '').trim().toUpperCase() === 'S';
/** "101" → [true, false, true]. */
const bits = (text: string | undefined, length: number) =>
  Array.from({ length }, (_, index) => (text ?? '').trim()[index] === '1');

/** "01/10/2026" → "2026-10-01". */
function isoDate(text: string | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? '').trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

const optional = (text: string | undefined) => {
  const clean = (text ?? '').trim();
  return clean && clean !== '-' ? clean : undefined;
};

function cyclePrices(row: Record<string, string>): CyclePrices | null {
  const fixedPerDay = num(row.TF);
  const a = num(row['TV|TVFV|TVP']);
  const b = num(row['TVV|TVC']);
  const c = num(row.TVVz);
  if (fixedPerDay === null || a === null) return null;
  switch (row.Contagem) {
    case '1':
      return { fixedPerDay, simple: a };
    case '2':
      return b === null ? null : { fixedPerDay, offEmpty: a, empty: b };
    case '3':
      return b === null || c === null ? null : { fixedPerDay, peak: a, full: b, empty: c };
    default:
      return null;
  }
}

type GasByEscalao = Partial<Record<'1' | '2' | '3' | '4', GasPrices>>;

function gasPrices(row: Record<string, string>): GasPrices | null {
  const fixedPerDay = num(row.TFGN);
  const perKwh = num(row.TVGN);
  return fixedPerDay === null || perKwh === null ? null : { fixedPerDay, perKwh };
}

const gasDiscounts = (row: Record<string, string>, prefix: 'Reemb' | 'Desc.') =>
  prefix === 'Reemb'
    ? {
        fixedTermPct: num(row['ReembTF_GN (%)']) ?? 0,
        energyPct: num(row['ReembTW_GN (%)']) ?? 0,
        energyPerKwh: num(row['ReembW_GN (€/kWh)']) ?? 0,
      }
    : {
        fixedTermPct: num(row['Desc. TF_GN (%) - Novo Cliente']) ?? 0,
        energyPct: num(row['Desc. TW_GN (%) - Novo Cliente']) ?? 0,
        energyPerKwh: num(row['Desc. W_GN (€/kWh) - Novo Cliente']) ?? 0,
      };

/** "a.zip" already written in the current format? (Older formats are rewritten.) */
export function isUpToDate(
  current: { source?: string; schemaVersion?: number },
  zipName: string,
): boolean {
  return current.source === zipName && current.schemaVersion === 2;
}

const segmentSchema = z.enum(['Dom', 'Ndom', 'Tod']);

export function normalize(
  conditions: Record<string, string>[],
  prices: Record<string, string>[],
  meta: { source: string; dataDate: string; fetchedAt: string },
): OffersFile {
  assertColumns(conditions, REQUIRED_OFFER_COLUMNS, 'CondComerciais.csv');
  assertColumns(prices, REQUIRED_PRICE_COLUMNS, 'Precos_ELEGN.csv');

  const byOffer = new Map<string, Offer['prices']>();
  for (const row of prices) {
    const power = num(row.Pot_Cont);
    const cycle = row.Contagem;
    const values = cyclePrices(row);
    if (power === null || !values || (cycle !== '1' && cycle !== '2' && cycle !== '3')) continue;
    const id = row.COD_Proposta ?? '';
    const offer = byOffer.get(id) ?? {};
    const key = String(power);
    offer[key] = { ...offer[key], [cycle]: values };
    byOffer.set(id, offer);
  }

  // Gas: rows with an escalão. With an operator (ORD) they are regulated tariffs.
  const gasByOffer = new Map<string, GasByEscalao>();
  const regulatedPrices = new Map<string, { ord: string; prices: GasByEscalao }>();
  for (const row of prices) {
    const escalao = escalaoSchema.safeParse(row.Escalao?.trim());
    const values = gasPrices(row);
    if (!escalao.success || !values) continue;
    const id = row.COD_Proposta ?? '';
    const ord = row.ORD?.trim();
    if (ord) {
      const entry = regulatedPrices.get(id) ?? { ord, prices: {} };
      entry.prices[escalao.data] = values;
      regulatedPrices.set(id, entry);
    } else {
      const offer = gasByOffer.get(id) ?? {};
      offer[escalao.data] = values;
      gasByOffer.set(id, offer);
    }
  }
  const regulatedGas: RegulatedGas = {};

  const offers: Offer[] = [];
  for (const row of conditions) {
    const supply = row.Fornecimento?.trim();
    if (supply !== 'ELE' && supply !== 'GN' && supply !== 'DUAL') continue;
    const segment = segmentSchema.safeParse(row.Segmento?.trim());
    const id = row.COD_Proposta ?? '';
    // Households only: offers exclusively for businesses (Ndom) are left out.
    if (!segment.success || segment.data === 'Ndom') continue;
    const regulated = regulatedPrices.get(id);
    if (regulated) {
      regulatedGas[regulated.ord] = {
        offerId: id,
        name: row.NomeProposta?.trim() ?? id,
        prices: regulated.prices,
      };
      continue;
    }
    const offerPrices = byOffer.get(id) ?? {};
    const offerGasPrices = gasByOffer.get(id) ?? {};
    // Only offers with the prices their supply needs.
    const hasElectricity = Object.keys(offerPrices).length > 0;
    const hasGas = Object.keys(offerGasPrices).length > 0;
    if ((supply === 'ELE' || supply === 'DUAL') && !hasElectricity) continue;
    if (supply === 'GN' && !hasGas) continue;
    const [directDebit = false, multibanco = false, cash = false] = bits(row.FiltroPagamento, 3);
    const [electronic = false, paper = false] = bits(row.Filtrofaturacao, 2);
    offers.push({
      id,
      supplier: row.COM?.trim() ?? '',
      name: row.NomeProposta?.trim() ?? id,
      segment: segment.data,
      supply,
      durationMonths: num(row.DuracaoContrato),
      validFrom: isoDate(row['Data ini']),
      validTo: isoDate(row['Data fim']),
      loyalty: flag(row['FiltroFidelização']),
      indexedPrices: flag(row.FiltroPrecosIndex_ELE),
      renewable: flag(row.FiltroRenovavel_ELE),
      restrictions: flag(row['FiltroRestrições']),
      requiredServices: flag(row.FiltroServicosAdic),
      servicesPerYearWithVat: num(row['CustoServicos_c/IVA (€/ano)']) ?? 0,
      discounts: {
        fixedPerYear: num(row['ReembFixo (€/ano)']) ?? 0,
        fixedTermPct: num(row['ReembTF_ELE (%)']) ?? 0,
        energyPct: num(row['ReembTW_ELE (%)']) ?? 0,
        energyPerKwh: num(row['ReembW_ELE (€/kWh)']) ?? 0,
      },
      newClientDiscounts: {
        fixedPerYearWithVat: num(row['DescontNovoCliente_c/IVA (€/ano)']) ?? 0,
        fixedTermPct: num(row['Desc. TF_ELE (%) - Novo Cliente']) ?? 0,
        energyPct: num(row['Desc. TW_ELE (%) - Novo Cliente']) ?? 0,
        energyPerKwh: num(row['Desc. W_ELE (€/kWh) - Novo Cliente']) ?? 0,
      },
      payment: { directDebit, multibanco, cash },
      billing: { electronic, paper },
      links: {
        ...(optional(row.LinkOfertaCom) ? { offer: optional(row.LinkOfertaCom) } : {}),
        ...(optional(row.LinkFichaPadrao) ? { standardSheet: optional(row.LinkFichaPadrao) } : {}),
        ...(optional(row.LinkCondicoesGerais)
          ? { generalTerms: optional(row.LinkCondicoesGerais) }
          : {}),
      },
      texts: {
        ...(optional(row['TxTFidelização']) ? { loyalty: optional(row['TxTFidelização']) } : {}),
        ...(optional(row.TxTRestricoesAdic)
          ? { restrictions: optional(row.TxTRestricoesAdic) }
          : {}),
        ...(optional(row.TxTAtualizaPrecos)
          ? { priceUpdates: optional(row.TxTAtualizaPrecos) }
          : {}),
      },
      prices: offerPrices,
      gasPrices: offerGasPrices,
      gasDiscounts: gasDiscounts(row, 'Reemb'),
      gasNewClientDiscounts: gasDiscounts(row, 'Desc.'),
    });
  }

  // Most regulated tariffs come with prices but no conditions row: keep them too.
  for (const [id, regulated] of regulatedPrices) {
    regulatedGas[regulated.ord] ??= { offerId: id, name: id, prices: regulated.prices };
  }

  return offersFileSchema.parse({ schemaVersion: 2, ...meta, regulatedGas, offers });
}

/** "20261013 122404 CSV.zip" → "2026-10-13". */
export function dataDateFromName(name: string): string | null {
  const match = /(\d{4})(\d{2})(\d{2})\s+\d{6}/.exec(name);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
