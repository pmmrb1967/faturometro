# Gas Comparator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare the user's natural gas contract with the ERSE gas offers, and electricity + gas together (dual offers vs. the best separate pair).

**Architecture:** The ERSE normalizer keeps gas prices per consumption tier (escalão) and the regulated tariffs per distribution operator in `erse-offers.json` v2. A pure `gas-cost.ts` estimates a gas bill (VAT 6 % on the network fixed term, 23 % on the rest) from prices plus charges read from the user's latest gas invoice; `compare-gas.ts` ranks offers and combines them with the electricity comparison. The compare page gets three tabs: Luz · Gás · Luz + gás.

**Tech Stack:** TypeScript strict, zod, Dexie, React 18, Vitest, fflate (ERSE ZIP).

**Spec:** `docs/superpowers/specs/2026-10-14-gas-comparator-design.md`

## Global Constraints

- Code, names and comments in English; user-visible text in European Portuguese (post-AO90, "tu"), only in `src/i18n/pt-PT.ts`.
- No `any`. Money: compute in euros as floats while estimating, round to integer cents once at the end (as `electricity-cost.ts`); conversions/formatting only through `src/lib/money.ts`.
- Never invent reference data (CLAUDE.md rule 6): distributor names only from the DGEG list in the spec; no municipality → distributor table; no escalão thresholds.
- Fixtures from real invoices are never committed, nor numbers copied from them into committed tests (they reveal the municipality). Committed tests use synthetic numbers only.
- Households only: `Ndom` offers stay out. "Estimativa", never "poupança garantida".
- Dexie: `Contract.gas` lives inside the encrypted record; no index change, no new schema version.
- `erse-offers.json` moves to `schemaVersion: 2`; app and data are published together.
- Before a task is done: `pnpm typecheck && pnpm lint && pnpm test` pass.
- Conventional Commits; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A DUAL offer that has electricity prices but no gas prices for the user's escalão — must not appear in "Luz + gás" with a gas cost of zero. Test in Task 5.
2. Expired or not-yet-valid gas offers — must be skipped like electricity offers. Test in Task 5.
3. A gas invoice with social-tariff discount lines on the network fixed term — those discounts must be taxed at 6 %, not 23 %. Test in Task 4.
4. The weekly ERSE sync after this change: an existing v1 file with the same ZIP name must still be rewritten as v2. Test in Task 1.
5. A gas contract whose latest invoice has no kWh (only m³) — the gas tab must explain, not crash. Test in Task 5 (`annualUsage` returns null → `compareGas` not called) and checked in the browser in Task 6.

---

## File Structure

- `src/domain/erse.ts` (modify) — schema v2: `supply` adds `GN`; `gasPrices`, `gasDiscounts`, `gasNewClientDiscounts`; file-level `regulatedGas`.
- `src/domain/gas-distributors.ts` (create) — the 11 operator codes and names.
- `scripts/erse/normalize.ts`, `scripts/erse/normalize.test.ts`, `scripts/erse-sync.ts` (modify) — gas columns, regulated tariffs, v2 rewrite.
- `public/data/erse-offers.json` (regenerated).
- `docs/gas-vat.md` (create) — VAT rules and the fixed-term finding.
- `src/domain/gas-cost.ts` + `gas-cost.test.ts` (create) — estimate and invoice breakdown.
- `src/domain/compare-gas.ts` + `compare-gas.test.ts` + `compare-gas.real.test.ts` (create) — ranking and combination.
- `src/domain/compare.ts`, `compare.test.ts` (modify) — remove `groupDualVariants` (dual offers leave the electricity tab).
- `src/parsers/types.ts`, `src/parsers/repsol.ts`, `src/parsers/repsol.test.ts` (modify) — escalão.
- `src/domain/types.ts`, `src/features/invoices/form.ts`, `src/features/invoices/save.ts` (modify) — `Contract.gas`.
- `src/features/compare/*` (modify/create) — tabs and sections.
- `src/i18n/pt-PT.ts` (modify), `planning/PLAN.md` (modify).

---

### Task 1: ERSE data v2 (gas prices, regulated tariffs)

**Files:**
- Modify: `src/domain/erse.ts`
- Create: `src/domain/gas-distributors.ts`
- Modify: `scripts/erse/normalize.ts`, `scripts/erse/normalize.test.ts`, `scripts/erse-sync.ts`
- Modify: `src/domain/compare.test.ts` (offer helper gets the new fields)
- Regenerate: `public/data/erse-offers.json`

**Interfaces:**
- Produces (in `src/domain/erse.ts`):

```ts
export const escalaoSchema = z.enum(['1', '2', '3', '4']);
export type Escalao = z.infer<typeof escalaoSchema>;
export const gasPricesSchema = z.object({ fixedPerDay: z.number(), perKwh: z.number() });
export type GasPrices = z.infer<typeof gasPricesSchema>;
const gasDiscountsSchema = z.object({
  fixedTermPct: z.number(),
  energyPct: z.number(),
  energyPerKwh: z.number(),
});
// offerSchema: supply: z.enum(['ELE', 'GN', 'DUAL']), gasPrices: z.partialRecord(escalaoSchema, gasPricesSchema),
//              gasDiscounts: gasDiscountsSchema, gasNewClientDiscounts: gasDiscountsSchema
export const regulatedGasSchema = z.record(
  z.string(),
  z.object({ offerId: z.string(), name: z.string(), prices: z.partialRecord(escalaoSchema, gasPricesSchema) }),
);
// offersFileSchema: schemaVersion: z.literal(2), regulatedGas: regulatedGasSchema
```

- Produces (in `src/domain/gas-distributors.ts`): `GAS_DISTRIBUTORS: readonly { code: string; name: string }[]` and `distributorName(code: string): string`.

- [ ] **Step 1: Failing tests**

In `scripts/erse/normalize.test.ts`, extend the synthetic tables (add the `_GN` discount columns to the header and a value per row; add a DUAL offer and a regulated offer):

```ts
const CONDITIONS = [
  '﻿COM;COD_Proposta;NomeProposta;Segmento;TipoContagem;Fornecimento;DuracaoContrato;Data ini;Data fim;Filtrofaturacao;FiltroPagamento;FiltroFidelização;FiltroRenovavel_ELE;FiltroRestrições;FiltroPrecosIndex_ELE;FiltroServicosAdic;CustoServicos_c/IVA (€/ano);ReembFixo (€/ano);ReembTF_ELE (%);ReembTW_ELE (%);ReembW_ELE (€/kWh);DescontNovoCliente_c/IVA (€/ano);Desc. TF_ELE (%) - Novo Cliente;Desc. TW_ELE (%) - Novo Cliente;Desc. W_ELE (€/kWh) - Novo Cliente;ReembTF_GN (%);ReembTW_GN (%);ReembW_GN (€/kWh);Desc. TF_GN (%) - Novo Cliente;Desc. TW_GN (%) - Novo Cliente;Desc. W_GN (€/kWh) - Novo Cliente;LinkOfertaCom;TxTFidelização',
  'ACME;ACME_01;Oferta Teste;Dom;12;ELE;12;01/10/2026;31/12/2026;10;100;N;S;N;N;N;;12,5;10;;;;;;;;;;;;;https://example.com/oferta;Não tem fidelização',
  'ACME;ACME_GN;Gás Teste;Dom;;GN;12;01/10/2026;31/12/2026;10;100;N;N;N;N;N;;;;;;;;;;;5;;;2;;;',
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
].join('\r\n');
```

Replace the first test and add new ones:

```ts
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
    });
    expect(file.schemaVersion).toBe(2);
  });
```

Add to `scripts/erse/normalize.test.ts` a test for the rewrite rule (Review Focus 4), against a new exported helper:

```ts
import { dataDateFromName, isUpToDate, normalize, parseCsv } from './normalize';
…
  it('rewrites a file of an older format even with the same ZIP', () => {
    expect(isUpToDate({ source: 'a.zip', schemaVersion: 2 }, 'a.zip')).toBe(true);
    expect(isUpToDate({ source: 'a.zip', schemaVersion: 1 }, 'a.zip')).toBe(false);
    expect(isUpToDate({ source: 'b.zip', schemaVersion: 2 }, 'a.zip')).toBe(false);
  });
```

In `src/domain/compare.test.ts` — and in every other test helper that builds an `Offer` (find them with `grep -rln "newClientDiscounts:" src scripts`) — the helper gets the new fields (before `...overrides`):

```ts
    gasPrices: {},
    gasDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    gasNewClientDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run scripts/erse`
Expected: FAIL (`gasPrices` undefined, `isUpToDate` not exported, `regulatedGas` missing).

- [ ] **Step 3: Schema (`src/domain/erse.ts`)**

Update the header comment to "Normalized ERSE electricity and gas offers". Add after `cyclePricesSchema`:

```ts
/** Natural gas consumption tier (escalão) as the ERSE codes it. */
export const escalaoSchema = z.enum(['1', '2', '3', '4']);
export type Escalao = z.infer<typeof escalaoSchema>;

export const gasPricesSchema = z.object({
  /** Fixed term, €/day, without VAT. */
  fixedPerDay: z.number(),
  /** Energy, €/kWh, without VAT. */
  perKwh: z.number(),
});
export type GasPrices = z.infer<typeof gasPricesSchema>;

const gasDiscountsSchema = z.object({
  fixedTermPct: z.number(),
  energyPct: z.number(),
  energyPerKwh: z.number(),
});
```

In `offerSchema`: `supply: z.enum(['ELE', 'GN', 'DUAL']),`; change the `prices` comment to "Electricity, by contracted power … (empty for gas-only offers)."; add after `prices`:

```ts
  /** Natural gas, by escalão (empty for electricity-only offers). */
  gasPrices: z.partialRecord(escalaoSchema, gasPricesSchema),
  /** Gas discounts for every client / only for new clients (shown, not applied). */
  gasDiscounts: gasDiscountsSchema,
  gasNewClientDiscounts: gasDiscountsSchema,
```

Add before `offersFileSchema`:

```ts
/** Regulated (last resort) gas tariffs, by distribution operator code (ORD). */
export const regulatedGasSchema = z.record(
  z.string(),
  z.object({
    offerId: z.string(),
    name: z.string(),
    prices: z.partialRecord(escalaoSchema, gasPricesSchema),
  }),
);
export type RegulatedGas = z.infer<typeof regulatedGasSchema>;
```

In `offersFileSchema`: `schemaVersion: z.literal(2),` and add `regulatedGas: regulatedGasSchema,`.

- [ ] **Step 4: Distributors (`src/domain/gas-distributors.ts`)**

```ts
/**
 * Natural gas distribution operators (ORD codes of the ERSE data). Names from
 * the DGEG list of concessions and licences:
 * https://www.dgeg.gov.pt/pt/areas-setoriais/energia/combustiveis/concessoes-e-licencas-sng/
 */
export const GAS_DISTRIBUTORS: readonly { code: string; name: string }[] = [
  { code: 'BEI', name: 'Beiragás' },
  { code: 'DIA', name: 'Dianagás' },
  { code: 'DUR', name: 'Duriensegás' },
  { code: 'LIS', name: 'Lisboagás' },
  { code: 'LUS', name: 'Lusitaniagás' },
  { code: 'MED', name: 'Medigás' },
  { code: 'PAX', name: 'Paxgás' },
  { code: 'REN', name: 'REN Portgás' },
  { code: 'SET', name: 'Setgás' },
  { code: 'SON', name: 'Sonorgás' },
  { code: 'TAG', name: 'Tagusgás' },
];

/** Name of an operator code; the code itself if the ERSE adds one not listed here. */
export function distributorName(code: string): string {
  return GAS_DISTRIBUTORS.find((item) => item.code === code)?.name ?? code;
}
```

- [ ] **Step 5: Normalizer (`scripts/erse/normalize.ts`)**

Import `escalaoSchema`, `type GasPrices`, `type RegulatedGas` from `../../src/domain/erse`.

Add `'Escalao', 'ORD', 'TFGN', 'TVGN'` to `REQUIRED_PRICE_COLUMNS`, and to `REQUIRED_OFFER_COLUMNS`:

```ts
  'ReembTF_GN (%)',
  'ReembTW_GN (%)',
  'ReembW_GN (€/kWh)',
  'Desc. TF_GN (%) - Novo Cliente',
  'Desc. TW_GN (%) - Novo Cliente',
  'Desc. W_GN (€/kWh) - Novo Cliente',
```

Add after `cyclePrices`:

```ts
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
```

In `normalize`, after the electricity price loop add the gas loop:

```ts
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
```

In the conditions loop, replace the supply/price checks:

```ts
    const supply = row.Fornecimento?.trim();
    if (supply !== 'ELE' && supply !== 'GN' && supply !== 'DUAL') continue;
    const segment = segmentSchema.safeParse(row.Segmento?.trim());
    const id = row.COD_Proposta ?? '';
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
    // Households only, and only offers with the prices their supply needs.
    const hasElectricity = Object.keys(offerPrices).length > 0;
    const hasGas = Object.keys(offerGasPrices).length > 0;
    if (supply === 'ELE' && !hasElectricity) continue;
    if (supply === 'GN' && !hasGas) continue;
    if (supply === 'DUAL' && !hasElectricity) continue;
```

and in the pushed object add after `prices: offerPrices,`:

```ts
      gasPrices: offerGasPrices,
      gasDiscounts: gasDiscounts(row, 'Reemb'),
      gasNewClientDiscounts: gasDiscounts(row, 'Desc.'),
```

Return: `return offersFileSchema.parse({ schemaVersion: 2, ...meta, regulatedGas, offers });`

- [ ] **Step 6: Sync script (`scripts/erse-sync.ts`)**

Import `isUpToDate` from `./erse/normalize`. Replace the up-to-date check:

```ts
  if (existsSync(OUTPUT)) {
    const current = JSON.parse(readFileSync(OUTPUT, 'utf8')) as {
      source?: string;
      schemaVersion?: number;
    };
    if (isUpToDate(current, zipName)) {
      console.log(`Already up to date (${zipName}).`);
      return;
    }
  }
```

and the final log: ``console.log(`✔ ${file.offers.length} offers (electricity, gas, dual) and ${Object.keys(file.regulatedGas).length} regulated gas tariffs from ${zipName} → public/data/erse-offers.json`);``

- [ ] **Step 7: Run tests, regenerate the data**

Run: `pnpm vitest run scripts/erse src/domain`
Expected: PASS.

Run: `pnpm erse:sync`
Expected: a line like `✔ 7xx offers … and 11 regulated gas tariffs …`. If the count of regulated tariffs is not 11, or any ORD code is missing from `GAS_DISTRIBUTORS`, STOP and record it in the ledger (the names list may need the new code — ask the user; do not guess a name).

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (`compare.real.test.ts` reads the new file).

- [ ] **Step 8: Commit**

```bash
git add src/domain/erse.ts src/domain/gas-distributors.ts scripts/erse/normalize.ts scripts/erse/normalize.test.ts scripts/erse-sync.ts src/domain/compare.test.ts public/data/erse-offers.json
git commit -m "feat(erse): gas and dual offer prices, regulated gas tariffs (data v2)"
```

---

### Task 2: Settle what the ERSE gas fixed term includes; document gas VAT

The invoice shows the commercial fixed term (`Termo Fixo (Escalão N)`) and the network fixed term (`Redes Termo Fixo`, 6 % VAT) separately. Whether the ERSE `TFGN` already includes the network part decides how the VAT split is applied to ERSE offers.

**Files:**
- Create: `docs/gas-vat.md`
- Create then delete (never commit): `src/domain/gas-probe.tmp.test.ts`

**Interfaces:**
- Produces: the decision `ERSE_GAS_FIXED_INCLUDES_NETWORK: boolean`, recorded in `docs/gas-vat.md` and used in Task 5.

- [ ] **Step 1: Probe against the real gas invoices (local only)**

`src/domain/gas-probe.tmp.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { repsolParser } from '../parsers/repsol';
import { layoutFixtures } from '../test/fixtures';
import { offersFileSchema } from './erse';

it('probe: ERSE gas fixed term vs invoice', () => {
  const file = offersFileSchema.parse(
    JSON.parse(readFileSync(join(__dirname, '../../public/data/erse-offers.json'), 'utf8')),
  );
  for (const fixture of layoutFixtures('repsol').filter((item) => item.private)) {
    for (const qr of fixture.qrs) {
      const result = repsolParser.parse(fixture, qr);
      if (result.sector !== 'gas') continue;
      const price = (pattern: RegExp) =>
        result.lines.find((line) => pattern.test(line.description) && line.unitPrice)?.unitPrice;
      const energy = Number(price(/^Energia$/));
      const fixed = Number(price(/^Termo Fixo/));
      const network = Number(price(/^Redes Termo Fixo/));
      const matches = file.offers.flatMap((offer) =>
        Object.entries(offer.gasPrices)
          .filter(([, p]) => Math.abs(p.perKwh - energy) < 0.00001)
          .map(([escalao, p]) => `${offer.id} esc ${escalao}: TFGN ${p.fixedPerDay}`),
      );
      console.log({ energy, fixed, network, fixedPlusNetwork: fixed + network, matches });
    }
  }
});
```

Run: `pnpm vitest run src/domain/gas-probe.tmp.test.ts` and read the printed lines.

Decision rule:
- If the matching offers' `TFGN` ≈ `fixed` (within 0.0005): `ERSE_GAS_FIXED_INCLUDES_NETWORK = false`.
- If ≈ `fixed + network`: `true`.
- If there are no matches or the numbers fit neither: STOP and ask the user (show the printed numbers; nothing personal: prices only).

Delete the probe file: `rm src/domain/gas-probe.tmp.test.ts`.

- [ ] **Step 2: `docs/gas-vat.md`**

Write (filling the finding from Step 1 in the last section):

```markdown
# IVA na fatura de gás natural

Portugal continental, consumos em baixa pressão até 10 000 m³ por ano (todas as casas):

| Componente | IVA |
|---|---|
| Termo fixo da tarifa de acesso às redes ("Redes Termo Fixo") | 6 % |
| Descontos sobre esse termo (ex.: desconto social nas redes, termo fixo) | 6 % |
| Termo fixo comercial, energia, descontos comerciais | 23 % |
| Imposto especial sobre o consumo de gás natural (IEC) | 23 % |
| Taxa de ocupação do subsolo (TOS), fixa e variável | 23 % |

Fontes (consultadas a 2026-10-14):
- ERSE, Tarifa social no gás natural 2025-2026 (exemplo de fatura com o termo fixo das redes a 6 %): <https://www.erse.pt/media/xnvl2elt/tarifa-social-gn-2025-2026_1-outubro-2025.pdf>
- CGD, Saldo Positivo, impostos e taxas na água, luz e gás: <https://www.cgd.pt/Site/Saldo-Positivo/casa-e-familia/Pages/impostos-e-taxas-agua-luz-gas.aspx>
- Faturas reais de gás da Repsol (fixtures privadas): `Redes Termo Fixo` e o seu desconto social a 6 %; o resto a 23 %.

## Termo fixo das ofertas da ERSE

<Resultado do passo 1: "O `TFGN` da ERSE **não inclui** / **inclui** o termo fixo das redes" + os números comparados (preço da energia, termo fixo da fatura, termo fixo das redes, TFGN), sem dados pessoais.>

## Implicações para o comparador

- Os encargos iguais em todas as ofertas (termo fixo das redes, TOS, IEC, descontos sociais) vêm da última fatura de gás do utilizador, em €/dia e €/kWh.
- O IVA a 6 % aplica-se ao termo fixo das redes (valor da fatura) e aos descontos sobre ele; tudo o resto a 23 %.
```

- [ ] **Step 3: Commit**

```bash
git add docs/gas-vat.md
git commit -m "docs: VAT on natural gas bills and the ERSE gas fixed term"
```

---

### Task 3: Escalão from the invoice into the gas contract

**Files:**
- Modify: `src/parsers/types.ts` (`ExtractedInvoice.gasEscalao`)
- Modify: `src/parsers/repsol.ts` (export `escalaoOf`, set the field, version `1.2.0`)
- Modify: `src/parsers/repsol.test.ts`
- Modify: `src/domain/types.ts` (`Contract.gas`)
- Modify: `src/features/invoices/form.ts`, `src/features/invoices/save.ts`

**Interfaces:**
- Produces: `ExtractedInvoice.gasEscalao?: Field<1 | 2 | 3 | 4>`; `escalaoOf(page: PageText): 1 | 2 | 3 | 4 | undefined`; `Contract.gas?: { escalao?: 1 | 2 | 3 | 4; distributor?: string }` (`distributor`: an ORD code or `'unknown'`).

- [ ] **Step 1: Failing tests**

Add to `src/parsers/repsol.test.ts`:

```ts
import { escalaoOf, repsolParser } from './repsol';
…
describe('escalaoOf', () => {
  const page = (strings: string[]) => ({
    page: 1,
    width: 600,
    height: 800,
    items: strings.map((str, index) => ({ str, x: 50, y: 100 + index * 12, width: 40, height: 10 })),
  });

  it('reads the gas consumption tier', () => {
    expect(escalaoOf(page(['Escalão', 'Escalão 2']))).toBe(2);
  });

  it('ignores pages without one', () => {
    expect(escalaoOf(page(['Potência: 6,90kVA']))).toBeUndefined();
    expect(escalaoOf(page(['Escalão 7']))).toBeUndefined();
  });
});
```

and in the per-document test, in the `else` branch (gas) after `expect(result.sector).toBe('gas');`:

```ts
      expect(result.gasEscalao?.value).toBeGreaterThanOrEqual(1);
      // Gas consumption comes in kWh (m³ × correction factor × calorific value).
      expect(result.readings.every((reading) => reading.unit === 'kWh')).toBe(true);
```

(The per-document test runs on the private fixtures locally; the synthetic fixture is electricity.)

Run: `pnpm vitest run src/parsers/repsol.test.ts`
Expected: FAIL (`escalaoOf` not exported).

- [ ] **Step 2: Implement**

`src/parsers/types.ts`, in `ExtractedInvoice` after `powerKva`:

```ts
  /** Natural gas consumption tier (escalão 1–4), as printed on the invoice. */
  gasEscalao?: Field<1 | 2 | 3 | 4>;
```

`src/parsers/repsol.ts`: add (import `type PageText` is already there):

```ts
/** "Escalão 2" on a gas invoice page → 2. */
export function escalaoOf(page: PageText): 1 | 2 | 3 | 4 | undefined {
  const item = page.items.find((candidate) => /^Escalão [1-4]$/.test(normalize(candidate.str)));
  const value = item ? Number(normalize(item.str).slice(-1)) : NaN;
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined;
}
```

In `parse`, after `result.sector = isGas ? 'gas' : 'electricity';`:

```ts
    const escalao = isGas ? escalaoOf(page) : undefined;
    if (escalao) result.gasEscalao = { value: escalao, confidence: 'high' };
```

and bump `version: '1.2.0'`.

`src/domain/types.ts`, in `Contract` after `electricity?`:

```ts
  gas?: {
    /** Consumption tier (escalão 1–4), from the invoice or chosen by the user. */
    escalao?: 1 | 2 | 3 | 4;
    /** Distribution operator: ERSE ORD code, or 'unknown'. Chosen by the user. */
    distributor?: string;
  };
```

`src/features/invoices/save.ts`: the `contractDetails` Pick gets `'gas'`:

```ts
  contractDetails?: Pick<
    Contract,
    'supplyPointId' | 'tariffName' | 'loyaltyEndDate' | 'electricity' | 'gas'
  >;
```

`src/features/invoices/form.ts`, in `contractDetails` before `return details;`:

```ts
  if (sector === 'gas' && extraction.gasEscalao) {
    details.gas = { escalao: extraction.gasEscalao.value };
  }
```

- [ ] **Step 3: Run**

Run: `pnpm vitest run src/parsers src/features/invoices && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/types.ts src/parsers/repsol.ts src/parsers/repsol.test.ts src/domain/types.ts src/features/invoices/form.ts src/features/invoices/save.ts
git commit -m "feat(gas): read the escalão from Repsol gas invoices into the contract"
```

---

### Task 4: Gas cost estimate and invoice breakdown

**Files:**
- Create: `src/domain/gas-cost.ts`
- Create: `src/domain/gas-cost.test.ts`

**Interfaces:**
- Consumes: `VAT_NORMAL`, `VAT_REDUCED`, `type Estimate` from `./electricity-cost`; `type InvoiceLine` from `./types`.
- Produces:

```ts
export interface GasOfferPrices {
  fixedPerDay: number;
  perKwh: number;
  fixedTermDiscountPct?: number;
  energyDiscountPct?: number;
  energyDiscountPerKwh?: number;
  discountPerYear?: number;
  servicesPerYearWithVat?: number;
  /** The fixed term already includes the network fixed term (ERSE TFGN, see docs/gas-vat.md). */
  fixedIncludesNetwork?: boolean;
}
export interface GasCommonCharges {
  /** Network access fixed term, €/day (VAT 6 %). */
  networkPerDay: number;
  /** Other €/day at 6 % (social discount on the network fixed term). */
  reducedPerDay: number;
  /** €/day at 23 % (fixed land-use fee…). */
  normalPerDay: number;
  /** €/kWh at 23 % (variable land-use fee, excise tax, social discount on energy…). */
  perKwh: number;
}
export const NO_GAS_COMMON_CHARGES: GasCommonCharges;
export function estimateGasCost(prices: GasOfferPrices, kwh: number, days: number, common?: GasCommonCharges): Estimate;
export interface GasBreakdown { prices: GasOfferPrices; common: GasCommonCharges; kwh: number }
export function gasBreakdownFromLines(lines: readonly GasLine[], days: number): GasBreakdown | null;
```

- [ ] **Step 1: Failing tests (`src/domain/gas-cost.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { estimateGasCost, gasBreakdownFromLines, NO_GAS_COMMON_CHARGES } from './gas-cost';
import type { InvoiceLine } from './types';

// Synthetic numbers only.
type Line = Pick<InvoiceLine, 'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice'>;

const LINES: Line[] = [
  { kind: 'power', description: 'Termo Fixo (Escalão 2)', amountCents: 450, quantity: 30, unit: 'day', unitPrice: '0.15' },
  { kind: 'power', description: 'Redes Termo Fixo', amountCents: 60, quantity: 30, unit: 'day', unitPrice: '0.02' },
  { kind: 'energy', description: 'Energia', amountCents: 1800, quantity: 200, unit: 'kWh', unitPrice: '0.09' },
  { kind: 'discount', description: 'Desc. DD Energia', amountCents: -90 },
  { kind: 'tax', description: 'Taxa Ocupação Subsolo Fixa', amountCents: 30 },
  { kind: 'tax', description: 'Taxa Ocupação Subsolo Variável', amountCents: 40 },
  { kind: 'tax', description: 'Imposto Especial Consumo GN', amountCents: 60 },
];

const COMMON = { networkPerDay: 0.02, reducedPerDay: 0, normalPerDay: 0.01, perKwh: 0.005 };

describe('estimateGasCost', () => {
  it('taxes the network fixed term at 6 % and the rest at 23 %', () => {
    const estimate = estimateGasCost({ fixedPerDay: 0.12, perKwh: 0.1 }, 100, 30, COMMON);
    expect(estimate).toMatchObject({ netCents: 1500, vatCents: 335, totalCents: 1835 });
  });

  it('gives the same total when the fixed term already includes the network part', () => {
    const estimate = estimateGasCost(
      { fixedPerDay: 0.14, perKwh: 0.1, fixedIncludesNetwork: true },
      100,
      30,
      COMMON,
    );
    expect(estimate).toMatchObject({ netCents: 1500, vatCents: 335, totalCents: 1835 });
  });

  it('applies the offer discounts and adds mandatory services', () => {
    const estimate = estimateGasCost(
      {
        fixedPerDay: 0.12,
        perKwh: 0.1,
        energyDiscountPct: 10,
        energyDiscountPerKwh: 0.01,
        fixedTermDiscountPct: 50,
        discountPerYear: 36.5,
        servicesPerYearWithVat: 3.65,
      },
      100,
      30,
      NO_GAS_COMMON_CHARGES,
    );
    expect(estimate).toMatchObject({ netCents: 680, vatCents: 156, totalCents: 866 });
  });
});

describe('gasBreakdownFromLines', () => {
  it('splits the invoice into offer prices and charges common to every offer', () => {
    const breakdown = gasBreakdownFromLines(LINES, 30);
    expect(breakdown?.kwh).toBe(200);
    expect(breakdown?.prices.fixedPerDay).toBeCloseTo(0.15, 10);
    expect(breakdown?.prices.perKwh).toBeCloseTo(0.09, 10);
    expect(breakdown?.prices.energyDiscountPct).toBeCloseTo(5, 10);
    expect(breakdown?.common.networkPerDay).toBeCloseTo(0.02, 10);
    expect(breakdown?.common.normalPerDay).toBeCloseTo(0.01, 10);
    expect(breakdown?.common.perKwh).toBeCloseTo(0.005, 10);
    expect(breakdown?.common.reducedPerDay).toBe(0);
  });

  it('reproduces the invoice when estimated for its own period', () => {
    const breakdown = gasBreakdownFromLines(LINES, 30)!;
    expect(estimateGasCost(breakdown.prices, breakdown.kwh, 30, breakdown.common)).toMatchObject({
      netCents: 2350,
      vatCents: 530,
    });
  });

  it('taxes social discounts on the network fixed term at 6 % (Review Focus 3)', () => {
    const social: Line[] = [
      ...LINES,
      { kind: 'discount', description: 'Desc. Social Redes Termo Fixo', amountCents: -60 },
      { kind: 'discount', description: 'Desc. Social Redes Energia', amountCents: -200 },
    ];
    const breakdown = gasBreakdownFromLines(social, 30)!;
    expect(breakdown.common.reducedPerDay).toBeCloseTo(-0.02, 10);
    expect(breakdown.common.perKwh).toBeCloseTo(-0.005, 10);
    expect(estimateGasCost(breakdown.prices, breakdown.kwh, 30, breakdown.common)).toMatchObject({
      netCents: 2090,
      vatCents: 481,
    });
  });

  it('needs priced energy in kWh', () => {
    expect(gasBreakdownFromLines(LINES.filter((line) => line.kind !== 'energy'), 30)).toBeNull();
    expect(gasBreakdownFromLines(LINES, 0)).toBeNull();
  });
});
```

Run: `pnpm vitest run src/domain/gas-cost.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/domain/gas-cost.ts`**

```ts
/**
 * Natural gas cost estimate for a number of days (docs/gas-vat.md):
 *   offer fixed term × days + kWh × price + charges common to every offer + VAT
 * VAT: 6 % on the network access fixed term and discounts on it, 23 % on the
 * rest. Euros as floats while computing; rounded to integer cents once.
 */
import { VAT_NORMAL, VAT_REDUCED, type Estimate } from './electricity-cost';
import type { InvoiceLine } from './types';

export interface GasOfferPrices {
  /** €/day, without VAT. */
  fixedPerDay: number;
  /** €/kWh, without VAT. */
  perKwh: number;
  fixedTermDiscountPct?: number;
  energyDiscountPct?: number;
  energyDiscountPerKwh?: number;
  /** €/year off the bill. */
  discountPerYear?: number;
  /** Mandatory extra services, €/year WITH VAT. */
  servicesPerYearWithVat?: number;
  /** The fixed term already includes the network fixed term (ERSE TFGN, see docs/gas-vat.md). */
  fixedIncludesNetwork?: boolean;
}

/** Charges that do not depend on the offer, read from the user's own gas invoice. */
export interface GasCommonCharges {
  /** Network access fixed term, €/day (VAT 6 %). */
  networkPerDay: number;
  /** Other €/day at 6 % (social discount on the network fixed term). */
  reducedPerDay: number;
  /** €/day at 23 % (fixed land-use fee…). */
  normalPerDay: number;
  /** €/kWh at 23 % (variable land-use fee, excise tax, social discount on energy…). */
  perKwh: number;
}

export const NO_GAS_COMMON_CHARGES: GasCommonCharges = {
  networkPerDay: 0,
  reducedPerDay: 0,
  normalPerDay: 0,
  perKwh: 0,
};

export function estimateGasCost(
  prices: GasOfferPrices,
  kwh: number,
  days: number,
  common: GasCommonCharges = NO_GAS_COMMON_CHARGES,
): Estimate {
  let energy = kwh * prices.perKwh * (1 - (prices.energyDiscountPct ?? 0) / 100);
  energy -= (prices.energyDiscountPerKwh ?? 0) * kwh;
  energy += common.perKwh * kwh;

  const network = common.networkPerDay * days;
  const offerFixed = prices.fixedPerDay * days * (1 - (prices.fixedTermDiscountPct ?? 0) / 100);
  // When the offer's fixed term already contains the network part, that part moves to 6 %.
  const fixedNormal =
    (prices.fixedIncludesNetwork ? offerFixed - network : offerFixed) +
    common.normalPerDay * days -
    ((prices.discountPerYear ?? 0) * days) / 365;
  const fixedReduced = network + common.reducedPerDay * days;

  const net = energy + fixedNormal + fixedReduced;
  const vat = (energy + fixedNormal) * VAT_NORMAL + fixedReduced * VAT_REDUCED;
  const services = ((prices.servicesPerYearWithVat ?? 0) * days) / 365;
  const netCents = Math.round(net * 100);
  const vatCents = Math.round(vat * 100);
  return {
    netCents,
    vatCents,
    totalCents: netCents + vatCents + Math.round(services * 100),
    reducedKwh: 0,
  };
}

type GasLine = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice'
>;

export interface GasBreakdown {
  /** The current contract's prices (fixed term without the network part). */
  prices: GasOfferPrices;
  common: GasCommonCharges;
  kwh: number;
}

const SOCIAL = /social/i;
const NETWORK = /redes/i;
const FIXED_TERM = /termo fixo/i;
const FIXED_FEE = /fixa/i;

/** null when the invoice has no priced energy in kWh (e.g. only m³, or no parser). */
export function gasBreakdownFromLines(
  lines: readonly GasLine[],
  days: number,
): GasBreakdown | null {
  const energy = lines.filter(
    (line) =>
      line.kind === 'energy' &&
      line.unit === 'kWh' &&
      line.unitPrice !== undefined &&
      (line.quantity ?? 0) > 0,
  );
  if (energy.length === 0 || days <= 0) return null;
  const kwh = energy.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const energyGross = energy.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * Number(line.unitPrice),
    0,
  );

  const fixed = lines.filter(
    (line) =>
      line.kind === 'power' &&
      line.unit === 'day' &&
      Number(line.unitPrice) > 0 &&
      !NETWORK.test(line.description) &&
      !SOCIAL.test(line.description),
  );
  const network = lines.filter(
    (line) => line.kind === 'power' && NETWORK.test(line.description) && line.amountCents > 0,
  );
  const offerDiscounts = lines.filter(
    (line) => line.kind === 'discount' && !SOCIAL.test(line.description),
  );

  const prices: GasOfferPrices = {
    fixedPerDay: fixed.reduce((sum, line) => sum + Number(line.unitPrice), 0),
    perKwh: energyGross / kwh,
  };
  const discount = -offerDiscounts.reduce((sum, line) => sum + line.amountCents, 0) / 100;
  if (discount > 0 && energyGross > 0) prices.energyDiscountPct = (discount / energyGross) * 100;

  const common: GasCommonCharges = {
    // From the amounts (the €/day shown is rounded; the amount is what was billed).
    networkPerDay: network.reduce((sum, line) => sum + line.amountCents, 0) / 100 / days,
    reducedPerDay: 0,
    normalPerDay: 0,
    perKwh: 0,
  };
  const handled = new Set<GasLine>([...energy, ...fixed, ...network, ...offerDiscounts]);
  for (const line of lines) {
    if (handled.has(line)) continue;
    if (line.kind === 'energy' && line.unitPrice === undefined) continue; // adjustments of earlier periods
    const euros = line.amountCents / 100;
    if (SOCIAL.test(line.description) && FIXED_TERM.test(line.description)) {
      common.reducedPerDay += euros / days;
    } else if (line.kind === 'tax' && FIXED_FEE.test(line.description)) {
      common.normalPerDay += euros / days;
    } else if (line.kind === 'tax' || line.kind === 'discount' || line.unit === 'kWh') {
      common.perKwh += euros / kwh;
    } else {
      common.normalPerDay += euros / days;
    }
  }
  return { prices, common, kwh };
}
```

- [ ] **Step 3: Run**

Run: `pnpm vitest run src/domain/gas-cost.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 4: Commit**

```bash
git add src/domain/gas-cost.ts src/domain/gas-cost.test.ts
git commit -m "feat(gas): gas bill estimate with the 6 % network fixed term"
```

---

### Task 5: Gas comparison and electricity + gas combination

**Files:**
- Create: `src/domain/compare-gas.ts`
- Create: `src/domain/compare-gas.test.ts`
- Create: `src/domain/compare-gas.real.test.ts`
- Modify: `src/domain/compare.test.ts` (m³ case)

**Interfaces:**
- Consumes: `estimateGasCost`, `gasBreakdownFromLines`, `type GasOfferPrices` (Task 4); `type AnnualUsage`, `type Comparison`, `type OfferResult` from `./compare`; `periodDays` from `./contract-prices`; `type Offer`, `type Escalao`, `type RegulatedGas` from `./erse` (Task 1); the Task 2 decision.
- Produces:

```ts
export const ERSE_GAS_FIXED_INCLUDES_NETWORK: boolean; // value from docs/gas-vat.md (Task 2)
export interface GasOfferResult { offer: Offer; annualCents: number; savingCents: number }
export interface GasComparison {
  usage: AnnualUsage;
  currentAnnualCents: number;
  /** GN and DUAL offers with prices for the escalão, cheapest first. */
  results: GasOfferResult[];
  regulated?: { code: string; name: string; annualCents: number };
}
export interface CompareGasInput {
  offers: Offer[];
  regulated: RegulatedGas;
  latest: { lines: InvoiceLine[]; periodStart: string; periodEnd: string };
  usage: AnnualUsage;
  escalao: Escalao;
  distributor?: string;
  today: string;
}
export function compareGas(input: CompareGasInput): GasComparison | null;
export interface DualResult { offer: Offer; cycle: CycleCode; annualCents: number; savingCents: number }
export interface BothComparison {
  currentAnnualCents: number;
  bestSeparate?: { electricity: OfferResult; gas: GasOfferResult; annualCents: number; savingCents: number };
  duals: DualResult[];
}
export function combineElectricityGas(electricity: Comparison, gas: GasComparison): BothComparison;
```

- [ ] **Step 1: Set the decision**

At the top of `src/domain/compare-gas.ts` (created in Step 3) the constant takes the value found in Task 2:

```ts
/** Whether ERSE gas fixed terms (TFGN) include the network fixed term: docs/gas-vat.md. */
export const ERSE_GAS_FIXED_INCLUDES_NETWORK = <true | false from Task 2>;
```

- [ ] **Step 2: Failing tests (`src/domain/compare-gas.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import type { AnnualUsage, Comparison, OfferResult } from './compare';
import { combineElectricityGas, compareGas, type GasComparison } from './compare-gas';
import type { Offer } from './erse';
import type { InvoiceLine } from './types';

// Synthetic data only.
const META = { updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id,
    supplier: 'ACME',
    name: id,
    segment: 'Dom',
    supply: 'GN',
    durationMonths: 12,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    loyalty: false,
    indexedPrices: false,
    renewable: false,
    restrictions: false,
    requiredServices: false,
    servicesPerYearWithVat: 0,
    discounts: { fixedPerYear: 0, fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    newClientDiscounts: { fixedPerYearWithVat: 0, fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    payment: { directDebit: true, multibanco: true, cash: false },
    billing: { electronic: true, paper: true },
    links: {},
    texts: {},
    prices: {},
    gasPrices: {},
    gasDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    gasNewClientDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    ...overrides,
  };
}

function line(fields: Partial<InvoiceLine> & Pick<InvoiceLine, 'kind' | 'description' | 'amountCents'>): InvoiceLine {
  return { ...META, id: fields.description, invoiceId: 'i1', ...fields };
}

const LATEST = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  lines: [
    line({ kind: 'power', description: 'Termo Fixo (Escalão 2)', amountCents: 450, quantity: 30, unit: 'day', unitPrice: '0.15' }),
    line({ kind: 'power', description: 'Redes Termo Fixo', amountCents: 60, quantity: 30, unit: 'day', unitPrice: '0.02' }),
    line({ kind: 'energy', description: 'Energia', amountCents: 1800, quantity: 200, unit: 'kWh', unitPrice: '0.09' }),
  ],
};
const USAGE: AnnualUsage = { byPeriod: {}, total: 2400, daysCovered: 365 };

const cheap = offer('CHEAP', { gasPrices: { '2': { fixedPerDay: 0.1, perKwh: 0.07 } } });
const dear = offer('DEAR', { gasPrices: { '2': { fixedPerDay: 0.2, perKwh: 0.12 } } });
const otherTier = offer('TIER1', { gasPrices: { '1': { fixedPerDay: 0.01, perKwh: 0.01 } } });
const expired = offer('OLD', { validTo: '2026-06-30', gasPrices: { '2': { fixedPerDay: 0.01, perKwh: 0.01 } } });
const future = offer('NEXT', { validFrom: '2027-01-01', gasPrices: { '2': { fixedPerDay: 0.01, perKwh: 0.01 } } });
const electricityOnly = offer('ELE', { supply: 'ELE', gasPrices: {} });
const dual = offer('DUAL', { supply: 'DUAL', gasPrices: { '2': { fixedPerDay: 0.09, perKwh: 0.065 } } });

const base = {
  regulated: {
    LIS: { offerId: 'CURLIS', name: 'Regulada Lisboa', prices: { '2': { fixedPerDay: 0.08, perKwh: 0.075 } } },
  },
  latest: LATEST,
  usage: USAGE,
  escalao: '2' as const,
  today: '2026-10-14',
};

describe('compareGas', () => {
  const result = compareGas({
    ...base,
    offers: [dear, cheap, otherTier, expired, future, electricityOnly, dual],
    distributor: 'LIS',
  })!;

  it('ranks valid gas and dual offers for the escalão, cheapest first', () => {
    expect(result.results.map((item) => item.offer.id)).toEqual(['DUAL', 'CHEAP', 'DEAR']);
  });

  it('skips expired and future offers (Review Focus 2) and other tiers', () => {
    const ids = result.results.map((item) => item.offer.id);
    expect(ids).not.toContain('OLD');
    expect(ids).not.toContain('NEXT');
    expect(ids).not.toContain('TIER1');
  });

  it('gives the saving against the current contract', () => {
    for (const item of result.results) {
      expect(item.savingCents).toBe(result.currentAnnualCents - item.annualCents);
    }
    expect(result.results.at(-1)!.savingCents).toBeLessThan(0);
  });

  it('adds the regulated tariff of the chosen distributor', () => {
    expect(result.regulated).toMatchObject({ code: 'LIS', name: 'Regulada Lisboa' });
    expect(result.regulated!.annualCents).toBeGreaterThan(0);
    const unknown = compareGas({ ...base, offers: [cheap], distributor: 'unknown' })!;
    expect(unknown.regulated).toBeUndefined();
  });

  it('needs priced energy in the latest invoice', () => {
    expect(compareGas({ ...base, offers: [cheap], latest: { ...LATEST, lines: [] } })).toBeNull();
  });
});

describe('combineElectricityGas', () => {
  const eleOffer = offer('E1', { supply: 'ELE' });
  const dualOffer = offer('D1', { supply: 'DUAL' });
  const dualNoGas = offer('D2', { supply: 'DUAL' });
  const gasOffer = offer('G1');
  const ele = (o: Offer, annualCents: number, cycle: '1' | '2' = '1'): OfferResult => ({
    offer: o,
    cycle,
    annualCents,
    savingCents: 60_000 - annualCents,
  });
  const electricity: Comparison = {
    usage: USAGE,
    currentAnnualCents: 60_000,
    // Sorted like compareOffers returns them.
    results: [
      ele(dualNoGas, 40_000),
      ele(dualOffer, 50_000),
      ele(eleOffer, 52_000),
      ele(dualOffer, 53_000, '2'),
    ],
  };
  const gas: GasComparison = {
    usage: USAGE,
    currentAnnualCents: 30_000,
    results: [
      { offer: dualOffer, annualCents: 24_000, savingCents: 6_000 },
      { offer: gasOffer, annualCents: 25_000, savingCents: 5_000 },
    ],
  };
  const both = combineElectricityGas(electricity, gas);

  it('adds the current contracts', () => {
    expect(both.currentAnnualCents).toBe(90_000);
  });

  it('pairs the best electricity-only and gas-only offers', () => {
    expect(both.bestSeparate).toMatchObject({ annualCents: 77_000, savingCents: 13_000 });
    expect(both.bestSeparate?.electricity.offer.id).toBe('E1');
    expect(both.bestSeparate?.gas.offer.id).toBe('G1');
  });

  it('prices dual offers with both parts, cheapest cycle, never without gas (Review Focus 1)', () => {
    expect(both.duals).toEqual([
      { offer: dualOffer, cycle: '1', annualCents: 74_000, savingCents: 16_000 },
    ]);
  });
});
```

Also add the "only m³" case (Review Focus 5) next to `annualUsage` in `src/domain/compare.test.ts`:

```ts
  it('has no estimate when the invoices bring only m³ (gas without kWh)', () => {
    const gasInvoice = invoice('g1', '2026-08-01', '2026-08-31');
    const m3: Reading = { ...reading('g1', undefined, 30), unit: 'm3' };
    expect(annualUsage([gasInvoice], [m3], '2026-10-14')).toBeNull();
  });
```

Run: `pnpm vitest run src/domain/compare-gas.test.ts src/domain/compare.test.ts`
Expected: FAIL (`./compare-gas` not found); the m³ test PASSES already (existing behaviour, pinned now).

- [ ] **Step 3: Implement `src/domain/compare-gas.ts`**

```ts
/**
 * Gas comparator and electricity + gas together (spec 2026-10-14): annual
 * kWh from the user's invoices, current cost from the latest gas invoice,
 * and the estimated annual cost of every valid ERSE gas or dual offer for the
 * contract's escalão. "Estimativa", never "poupança garantida".
 */
import type { AnnualUsage, Comparison, OfferResult } from './compare';
import { periodDays } from './contract-prices';
import type { CycleCode, Escalao, GasPrices, Offer, RegulatedGas } from './erse';
import { estimateGasCost, gasBreakdownFromLines, type GasOfferPrices } from './gas-cost';
import type { InvoiceLine } from './types';

const YEAR = 365;

/** Whether ERSE gas fixed terms (TFGN) include the network fixed term: docs/gas-vat.md. */
export const ERSE_GAS_FIXED_INCLUDES_NETWORK = false; // ← value decided in Task 2

export interface GasOfferResult {
  offer: Offer;
  annualCents: number;
  /** Positive = cheaper than the current contract. */
  savingCents: number;
}

export interface GasComparison {
  usage: AnnualUsage;
  currentAnnualCents: number;
  /** GN and DUAL offers with prices for the escalão, cheapest first. */
  results: GasOfferResult[];
  regulated?: { code: string; name: string; annualCents: number };
}

export interface CompareGasInput {
  offers: Offer[];
  regulated: RegulatedGas;
  latest: { lines: InvoiceLine[]; periodStart: string; periodEnd: string };
  usage: AnnualUsage;
  escalao: Escalao;
  /** ERSE ORD code, 'unknown' or undefined. */
  distributor?: string;
  today: string;
}

function offerGasPrices(offer: Offer, prices: GasPrices): GasOfferPrices {
  // Yearly discounts and mandatory services belong to the electricity part of a dual offer.
  const gasOnly = offer.supply === 'GN';
  return {
    fixedPerDay: prices.fixedPerDay,
    perKwh: prices.perKwh,
    fixedTermDiscountPct: offer.gasDiscounts.fixedTermPct,
    energyDiscountPct: offer.gasDiscounts.energyPct,
    energyDiscountPerKwh: offer.gasDiscounts.energyPerKwh,
    discountPerYear: gasOnly ? offer.discounts.fixedPerYear : 0,
    servicesPerYearWithVat: gasOnly ? offer.servicesPerYearWithVat : 0,
    fixedIncludesNetwork: ERSE_GAS_FIXED_INCLUDES_NETWORK,
  };
}

const isValid = (offer: Offer, today: string) =>
  !(offer.validFrom && offer.validFrom > today) && !(offer.validTo && offer.validTo < today);

export function compareGas(input: CompareGasInput): GasComparison | null {
  const breakdown = gasBreakdownFromLines(
    input.latest.lines,
    periodDays(input.latest.periodStart, input.latest.periodEnd),
  );
  if (!breakdown) return null;
  const kwh = input.usage.total;
  const current = estimateGasCost(breakdown.prices, kwh, YEAR, breakdown.common);

  const results: GasOfferResult[] = [];
  for (const offer of input.offers) {
    if (offer.supply === 'ELE' || !isValid(offer, input.today)) continue;
    const prices = offer.gasPrices[input.escalao];
    if (!prices) continue;
    const estimate = estimateGasCost(offerGasPrices(offer, prices), kwh, YEAR, breakdown.common);
    results.push({
      offer,
      annualCents: estimate.totalCents,
      savingCents: current.totalCents - estimate.totalCents,
    });
  }
  results.sort((a, b) => a.annualCents - b.annualCents);

  const comparison: GasComparison = {
    usage: input.usage,
    currentAnnualCents: current.totalCents,
    results,
  };
  const regulated = input.distributor ? input.regulated[input.distributor] : undefined;
  const regulatedPrices = regulated?.prices[input.escalao];
  if (regulated && regulatedPrices && input.distributor) {
    comparison.regulated = {
      code: input.distributor,
      name: regulated.name,
      annualCents: estimateGasCost(
        { ...regulatedPrices, fixedIncludesNetwork: ERSE_GAS_FIXED_INCLUDES_NETWORK },
        kwh,
        YEAR,
        breakdown.common,
      ).totalCents,
    };
  }
  return comparison;
}

export interface DualResult {
  offer: Offer;
  cycle: CycleCode;
  annualCents: number;
  savingCents: number;
}

export interface BothComparison {
  currentAnnualCents: number;
  /** Best electricity-only offer + best gas-only offer (suppliers may differ). */
  bestSeparate?: {
    electricity: OfferResult;
    gas: GasOfferResult;
    annualCents: number;
    savingCents: number;
  };
  /** Dual offers priced with both parts, cheapest first. */
  duals: DualResult[];
}

export function combineElectricityGas(
  electricity: Comparison,
  gas: GasComparison,
): BothComparison {
  const currentAnnualCents = electricity.currentAnnualCents + gas.currentAnnualCents;
  const both: BothComparison = { currentAnnualCents, duals: [] };

  const bestElectricity = electricity.results.find((item) => item.offer.supply === 'ELE');
  const bestGas = gas.results.find((item) => item.offer.supply === 'GN');
  if (bestElectricity && bestGas) {
    const annualCents = bestElectricity.annualCents + bestGas.annualCents;
    both.bestSeparate = {
      electricity: bestElectricity,
      gas: bestGas,
      annualCents,
      savingCents: currentAnnualCents - annualCents,
    };
  }

  // A dual offer only counts when it has a gas price for the escalão.
  const gasById = new Map(
    gas.results
      .filter((item) => item.offer.supply === 'DUAL')
      .map((item) => [item.offer.id, item]),
  );
  const seen = new Set<string>();
  // Electricity results are sorted: the first one of an offer is its cheapest cycle.
  for (const item of electricity.results) {
    if (item.offer.supply !== 'DUAL' || seen.has(item.offer.id)) continue;
    const gasPart = gasById.get(item.offer.id);
    if (!gasPart) continue;
    seen.add(item.offer.id);
    const annualCents = item.annualCents + gasPart.annualCents;
    both.duals.push({
      offer: item.offer,
      cycle: item.cycle,
      annualCents,
      savingCents: currentAnnualCents - annualCents,
    });
  }
  both.duals.sort((a, b) => a.annualCents - b.annualCents);
  return both;
}
```

- [ ] **Step 4: Keep `groupDualVariants` for now**

The page still uses it; it is removed in Task 6 Step 4, together with the page change, so every commit typechecks.

- [ ] **Step 5: Real invoices (local only) — `src/domain/compare-gas.real.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { repsolParser } from '../parsers/repsol';
import { layoutFixtures } from '../test/fixtures';
import { periodDays } from './contract-prices';
import { estimateGasCost, gasBreakdownFromLines } from './gas-cost';

// Real gas invoices (private fixtures, local only; skipped in CI).
const gasInvoices = layoutFixtures('repsol')
  .filter((fixture) => fixture.private)
  .flatMap((fixture) => fixture.qrs.map((qr) => ({ qr, result: repsolParser.parse(fixture, qr) })))
  .filter(({ result }) => result.sector === 'gas');

describe.skipIf(gasInvoices.length === 0)('gas cost with real invoices', () => {
  it.each(gasInvoices.map((item, index) => ({ ...item, name: `invoice ${index + 1}` })))(
    '$name: the estimate for its own period matches the total ±2 %',
    ({ qr, result }) => {
      const days = periodDays(result.periodStart!.value, result.periodEnd!.value);
      const breakdown = gasBreakdownFromLines(result.lines, days);
      expect(breakdown).not.toBeNull();
      const estimate = estimateGasCost(breakdown!.prices, breakdown!.kwh, days, breakdown!.common);
      expect(Math.abs(estimate.totalCents - qr.totalCents)).toBeLessThanOrEqual(
        Math.max(2, qr.totalCents * 0.02),
      );
    },
  );
});
```

- [ ] **Step 6: Run**

Run: `pnpm vitest run src/domain`
Expected: PASS (the real test runs locally with the private fixtures and must pass; if it fails, use superpowers:systematic-debugging on `gasBreakdownFromLines` — never widen the tolerance).

- [ ] **Step 7: Commit**

```bash
git add src/domain/compare-gas.ts src/domain/compare-gas.test.ts src/domain/compare-gas.real.test.ts src/domain/compare.test.ts
git commit -m "feat(gas): rank gas offers and combine electricity + gas"
```

---

### Task 6: Compare page — tabs, gas, electricity + gas

**Files:**
- Modify: `src/features/compare/ComparePage.tsx` (data loading + tabs)
- Create: `src/features/compare/OfferCard.tsx` (shared card)
- Create: `src/features/compare/ElectricitySection.tsx`, `GasSection.tsx`, `BothSection.tsx`
- Modify: `src/features/compare/compare.css`
- Modify: `src/domain/compare.ts` (delete `DisplayResult`/`groupDualVariants` if not done in Task 5)
- Modify: `src/i18n/pt-PT.ts`

**Interfaces:**
- Consumes: `compareOffers`, `annualUsage` (existing); `compareGas`, `combineElectricityGas`, `type GasComparison`, `type BothComparison` (Task 5); `GAS_DISTRIBUTORS`, `distributorName` (Task 1); `Contract.gas` (Task 3).
- Produces: UI only.

- [ ] **Step 1: Texts (`src/i18n/pt-PT.ts`, inside `compare`)**

Change `title` to `'Comparar'` and `intro` to `'Estimativa do custo anual com os preços de cada oferta publicada pela ERSE, para o teu consumo real. Inclui IVA e as taxas da tua fatura.'`. Remove `dualVariant` and `dualOnly`. Add:

```ts
    tabs: { electricity: 'Luz', gas: 'Gás', both: 'Luz + gás' },
    gas: {
      noContract:
        'Para comparar o gás, adiciona uma fatura de gás lida automaticamente (por agora, da Repsol), com período e consumo em kWh.',
      noKwh:
        'As tuas faturas de gás não trazem o consumo em kWh: sem o fator de conversão da fatura, não é possível estimar.',
      escalao: 'Escalão de consumo',
      escalaoHint: 'Vem na tua fatura de gás (ex.: "Escalão 1").',
      escalaoChoose: 'Escolhe o escalão',
      distributor: 'Distribuidor de gás da tua zona',
      distributorHint:
        'Aparece no contrato ou na área de cliente. Serve só para mostrar a tarifa regulada da tua zona.',
      distributorChoose: 'Escolhe o distribuidor',
      distributorUnknown: 'Não sei',
      usage: (value: string) => `Consumo anual estimado: ${value} kWh de gás`,
      seasonal:
        'O gás varia muito entre inverno e verão: com menos de um ano de faturas, a estimativa pode falhar bastante.',
      regulated: (name: string, value: string) => `Tarifa regulada (${name}): ${value}/ano`,
      missingTaxes:
        'A tua última fatura não traz a taxa de ocupação do subsolo nem o imposto especial: não estão incluídos.',
    },
    both: {
      current: 'Os teus contratos atuais (luz + gás, estimativa anual)',
      separate: 'Melhor combinação de ofertas separadas',
      separatePair: (electricity: string, gas: string) => `${electricity} (luz) + ${gas} (gás)`,
      duals: 'Ofertas conjuntas de luz e gás mais baratas',
      noneDual: 'Nenhuma oferta conjunta é mais barata do que os teus contratos atuais.',
      needsBoth: 'Para comparar luz e gás juntos, precisas de um contrato de cada com faturas lidas.',
    },
```

In `glossary.items` add:

```ts
        ['Escalão', 'Nível de consumo anual de gás (1 a 4) definido pelo distribuidor; os preços das ofertas dependem dele.'],
        ['Distribuidor', 'Empresa dona da rede de gás da tua zona (ex.: Lisboagás). É a mesma, seja qual for o comercializador.'],
        ['Tarifa regulada', 'Preço fixado pela ERSE para quem fica no mercado regulado; serve de referência.'],
        ['TOS', 'Taxa de ocupação do subsolo: cobrada pelo município, igual em todas as ofertas.'],
        ['IEC', 'Imposto especial sobre o consumo de gás natural, igual em todas as ofertas.'],
```

- [ ] **Step 2: Shared card (`src/features/compare/OfferCard.tsx`)**

Move `OfferCard` out of `ComparePage.tsx`, generalized:

```tsx
import type { Offer } from '../../domain/erse';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';

const copy = t.compare;

/** One offer: name, supplier (and cycle), yearly estimate, saving and conditions. */
export function OfferCard({
  offer,
  detail,
  annualCents,
  savingCents,
}: {
  offer: Offer;
  /** E.g. the electricity cycle ("Simples"). */
  detail?: string;
  annualCents: number;
  savingCents: number;
}) {
  const conditions = copy.conditions;
  const newClients = offer.newClientDiscounts;
  const newGas = offer.gasNewClientDiscounts;
  const hasNewClientDiscount = Boolean(
    newClients.fixedPerYearWithVat ||
      newClients.fixedTermPct ||
      newClients.energyPct ||
      newClients.energyPerKwh ||
      newGas.fixedTermPct ||
      newGas.energyPct ||
      newGas.energyPerKwh,
  );
  const tags = (
    [
      [offer.loyalty, conditions.loyalty],
      [offer.indexedPrices, conditions.indexed],
      [offer.requiredServices, conditions.requiredServices],
      [offer.restrictions, conditions.restrictions],
      [
        offer.payment.directDebit && !offer.payment.multibanco && !offer.payment.cash,
        conditions.directDebitOnly,
      ],
      [offer.billing.electronic && !offer.billing.paper, conditions.electronicOnly],
      [hasNewClientDiscount, conditions.newClients],
    ] as [boolean, string][]
  )
    .filter(([applies]) => applies)
    .map(([, label]) => label);

  return (
    <li className="offer">
      <div className="offer-head">
        <div>
          <strong>{offer.name}</strong>
          <span className="muted">
            {offer.supplier}
            {detail ? ` · ${detail}` : ''}
          </span>
        </div>
        <p className="compare-amount">
          {formatCents(annualCents)}
          <span>{copy.perYear}</span>
        </p>
      </div>
      <p className="offer-saving">{copy.saving(formatCents(savingCents))}</p>
      {tags.length > 0 && (
        <ul className="offer-tags">
          {tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      {(offer.links.standardSheet ?? offer.links.offer) && (
        <a href={offer.links.standardSheet ?? offer.links.offer} target="_blank" rel="noreferrer">
          {copy.sheet}
        </a>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Sections**

`src/features/compare/ElectricitySection.tsx` — the current electricity body of `ComparePage`, now only `ELE` offers:

```tsx
import type { Comparison } from '../../domain/compare';
import type { Contract, Provider } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';

const copy = t.compare;
const TOP = 5;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

export function ElectricitySection({
  comparison,
  contract,
  provider,
}: {
  comparison: Comparison;
  contract: Contract;
  provider?: Provider;
}) {
  const cheaper = comparison.results.filter(
    (result) => result.offer.supply === 'ELE' && result.savingCents > 0,
  );
  return (
    <>
      <section className="compare-current" aria-labelledby="compare-current">
        <h2 id="compare-current">{copy.current}</h2>
        <p className="compare-amount">
          {formatCents(comparison.currentAnnualCents)}
          <span>{copy.perYear}</span>
        </p>
        <p>
          {copy.usage(kwh.format(comparison.usage.total))}
          {provider ? ` · ${provider.name}` : ''}
          {contract.tariffName ? ` · ${contract.tariffName}` : ''}
        </p>
        {comparison.usage.daysCovered < 365 && (
          <p className="muted">{copy.usageExtrapolated(comparison.usage.daysCovered)}</p>
        )}
        {(contract.electricity?.powerKva ?? 0) <= 3.45 && (
          <p className="muted">{copy.lowPowerNote}</p>
        )}
      </section>
      <h2 className="section-title">{copy.best}</h2>
      {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
      <ol className="offers">
        {cheaper.slice(0, TOP).map((result) => (
          <OfferCard
            key={`${result.offer.id}-${result.cycle}`}
            offer={result.offer}
            detail={copy.cycles[result.cycle]}
            annualCents={result.annualCents}
            savingCents={result.savingCents}
          />
        ))}
      </ol>
    </>
  );
}
```

`src/features/compare/GasSection.tsx`:

```tsx
import type { GasComparison } from '../../domain/compare-gas';
import { distributorName, GAS_DISTRIBUTORS } from '../../domain/gas-distributors';
import type { Contract, Provider } from '../../domain/types';
import { SelectField } from '../../components/Field';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';

const copy = t.compare;
const gasCopy = copy.gas;
const TOP = 5;
const kwh = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });

export function GasSection({
  comparison,
  contract,
  provider,
  missingTaxes,
  onChange,
}: {
  comparison: GasComparison | null;
  contract: Contract;
  provider?: Provider;
  /** The latest invoice has no land-use fee nor excise tax line. */
  missingTaxes: boolean;
  onChange: (gas: NonNullable<Contract['gas']>) => void;
}) {
  const gas = contract.gas ?? {};
  const cheaper = (comparison?.results ?? []).filter(
    (result) => result.offer.supply === 'GN' && result.savingCents > 0,
  );
  return (
    <>
      <div className="compare-settings">
        <SelectField
          id="gas-escalao"
          label={gasCopy.escalao}
          hint={gasCopy.escalaoHint}
          value={gas.escalao ? String(gas.escalao) : ''}
          onChange={(event) =>
            onChange({ ...gas, escalao: Number(event.target.value) as 1 | 2 | 3 | 4 })
          }
        >
          {!gas.escalao && <option value="">{gasCopy.escalaoChoose}</option>}
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="gas-distributor"
          label={gasCopy.distributor}
          hint={gasCopy.distributorHint}
          value={gas.distributor ?? ''}
          onChange={(event) => onChange({ ...gas, distributor: event.target.value })}
        >
          {!gas.distributor && <option value="">{gasCopy.distributorChoose}</option>}
          {GAS_DISTRIBUTORS.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
          <option value="unknown">{gasCopy.distributorUnknown}</option>
        </SelectField>
      </div>

      {comparison && (
        <>
          <section className="compare-current" aria-labelledby="compare-gas-current">
            <h2 id="compare-gas-current">{copy.current}</h2>
            <p className="compare-amount">
              {formatCents(comparison.currentAnnualCents)}
              <span>{copy.perYear}</span>
            </p>
            <p>
              {gasCopy.usage(kwh.format(comparison.usage.total))}
              {provider ? ` · ${provider.name}` : ''}
              {contract.tariffName ? ` · ${contract.tariffName}` : ''}
            </p>
            {comparison.usage.daysCovered < 365 && (
              <p className="ingest-problem">{gasCopy.seasonal}</p>
            )}
            {missingTaxes && <p className="muted">{gasCopy.missingTaxes}</p>}
            {comparison.regulated && (
              <p className="muted">
                {gasCopy.regulated(
                  distributorName(comparison.regulated.code),
                  formatCents(comparison.regulated.annualCents),
                )}
              </p>
            )}
          </section>
          <h2 className="section-title">{copy.best}</h2>
          {cheaper.length === 0 && <p className="muted">{copy.none}</p>}
          <ol className="offers">
            {cheaper.slice(0, TOP).map((result) => (
              <OfferCard
                key={result.offer.id}
                offer={result.offer}
                annualCents={result.annualCents}
                savingCents={result.savingCents}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}
```

`src/features/compare/BothSection.tsx`:

```tsx
import type { BothComparison } from '../../domain/compare-gas';
import { t } from '../../i18n/pt-PT';
import { formatCents } from '../../lib/money';
import { OfferCard } from './OfferCard';

const copy = t.compare;
const bothCopy = copy.both;
const TOP = 5;

export function BothSection({ comparison }: { comparison: BothComparison }) {
  const cheaper = comparison.duals.filter((item) => item.savingCents > 0);
  const separate = comparison.bestSeparate;
  return (
    <>
      <section className="compare-current" aria-labelledby="compare-both-current">
        <h2 id="compare-both-current">{bothCopy.current}</h2>
        <p className="compare-amount">
          {formatCents(comparison.currentAnnualCents)}
          <span>{copy.perYear}</span>
        </p>
      </section>
      {separate && (
        <section className="compare-current" aria-labelledby="compare-both-separate">
          <h2 id="compare-both-separate">{bothCopy.separate}</h2>
          <p className="compare-amount">
            {formatCents(separate.annualCents)}
            <span>{copy.perYear}</span>
          </p>
          <p>{bothCopy.separatePair(separate.electricity.offer.name, separate.gas.offer.name)}</p>
          <p className="offer-saving">
            {separate.savingCents > 0
              ? copy.saving(formatCents(separate.savingCents))
              : copy.moreExpensive(formatCents(-separate.savingCents))}
          </p>
        </section>
      )}
      <h2 className="section-title">{bothCopy.duals}</h2>
      {cheaper.length === 0 && <p className="muted">{bothCopy.noneDual}</p>}
      <ol className="offers">
        {cheaper.slice(0, TOP).map((item) => (
          <OfferCard
            key={item.offer.id}
            offer={item.offer}
            detail={copy.cycles[item.cycle]}
            annualCents={item.annualCents}
            savingCents={item.savingCents}
          />
        ))}
      </ol>
    </>
  );
}
```

- [ ] **Step 4: `ComparePage.tsx` (data + tabs)**

Replace the file with:

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { SelectField } from '../../components/Field';
import { annualUsage, compareOffers } from '../../domain/compare';
import { combineElectricityGas, compareGas } from '../../domain/compare-gas';
import { offersFileSchema, type OffersFile } from '../../domain/erse';
import type { Contract, Invoice, InvoiceLine, Provider, Reading } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { BothSection } from './BothSection';
import { recordCheaperOffer } from './cheaper-offer';
import { ElectricitySection } from './ElectricitySection';
import { GasSection } from './GasSection';
import './compare.css';

const copy = t.compare;
type Tab = 'electricity' | 'gas' | 'both';
const TAB_KEY = 'faturometro.compare.tab';

interface Candidate {
  contract: Contract;
  provider?: Provider;
  invoices: Invoice[];
  readings: Reading[];
  latest: Invoice;
  lines: InvoiceLine[];
}

function useOffers(): OffersFile | null | 'error' {
  const [offers, setOffers] = useState<OffersFile | null | 'error'>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/data/erse-offers.json')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((json: unknown) => {
        const parsed = offersFileSchema.safeParse(json);
        if (!cancelled) setOffers(parsed.success ? parsed.data : 'error');
      })
      .catch(() => {
        if (!cancelled) setOffers('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return offers;
}

function savedTab(): Tab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return value === 'gas' || value === 'both' ? value : 'electricity';
  } catch {
    return 'electricity';
  }
}

export function ComparePage() {
  const { session } = useSession();
  const offers = useOffers();
  const [tab, setTab] = useState<Tab>(savedTab);
  const [chosenElectricity, setChosenElectricity] = useState<string | null>(null);
  const [chosenGas, setChosenGas] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    if (!session) return null;
    const [contracts, providers, settings] = await Promise.all([
      session.repos.contracts.list(),
      session.repos.providers.list(),
      getSettings(session.repos),
    ]);
    const load = async (contract: Contract): Promise<Candidate | null> => {
      const [invoices, readings] = await Promise.all([
        session.repos.invoices.findBy('contractId', contract.id),
        session.repos.readings.findBy('contractId', contract.id),
      ]);
      const latest = invoices
        .filter((invoice) => invoice.periodStart && invoice.periodEnd)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
      if (!latest) return null;
      const lines = await session.repos.invoiceLines.findBy('invoiceId', latest.id);
      const provider = providers.find((item) => item.id === contract.providerId);
      return { contract, provider, invoices, readings, latest, lines };
    };
    const loaded = async (sector: 'electricity' | 'gas') =>
      (
        await Promise.all(
          contracts
            .filter(
              (item) =>
                item.sector === sector && (sector === 'gas' || item.electricity !== undefined),
            )
            .map(load),
        )
      ).filter((item): item is Candidate => item !== null);
    return { electricity: await loaded('electricity'), gas: await loaded('gas'), settings };
  }, [session]);

  const electricity =
    data?.electricity.find((item) => item.contract.id === chosenElectricity) ??
    data?.electricity[0];
  // By default, the gas contract billed in the same file as the electricity one (dual invoices).
  const sameFile = (item: Candidate) =>
    electricity?.invoices.some((invoice) => item.invoices.some((g) => g.fileHash === invoice.fileHash));
  const gas =
    data?.gas.find((item) => item.contract.id === chosenGas) ??
    data?.gas.find(sameFile) ??
    data?.gas[0];

  const date = today();
  const ready = offers && offers !== 'error' ? offers : null;

  const electricityComparison = useMemo(() => {
    if (!electricity?.contract.electricity || !ready || !data) return null;
    const usage = annualUsage(electricity.invoices, electricity.readings, date);
    if (!usage) return null;
    return compareOffers({
      offers: ready.offers,
      latest: {
        lines: electricity.lines,
        periodStart: electricity.latest.periodStart!,
        periodEnd: electricity.latest.periodEnd!,
      },
      usage,
      household: {
        powerKva: electricity.contract.electricity.powerKva,
        largeFamily: data.settings.largeFamily,
      },
      today: date,
    });
  }, [electricity, ready, data, date]);

  const gasUsage = useMemo(
    () => (gas ? annualUsage(gas.invoices, gas.readings, date) : null),
    [gas, date],
  );
  const gasComparison = useMemo(() => {
    const escalao = gas?.contract.gas?.escalao;
    if (!gas || !ready || !gasUsage || !escalao) return null;
    return compareGas({
      offers: ready.offers,
      regulated: ready.regulatedGas,
      latest: {
        lines: gas.lines,
        periodStart: gas.latest.periodStart!,
        periodEnd: gas.latest.periodEnd!,
      },
      usage: gasUsage,
      escalao: String(escalao) as '1' | '2' | '3' | '4',
      ...(gas.contract.gas?.distributor ? { distributor: gas.contract.gas.distributor } : {}),
      today: date,
    });
  }, [gas, ready, gasUsage, date]);

  const both = useMemo(
    () =>
      electricityComparison && gasComparison
        ? combineElectricityGas(electricityComparison, gasComparison)
        : null,
    [electricityComparison, gasComparison],
  );

  // "Cheaper offer" alert (PLAN.md §9) for electricity, once per ERSE data update.
  useEffect(() => {
    if (!session || !electricity || !electricityComparison || !ready || !data) return;
    const best = electricityComparison.results.find((item) => item.offer.supply === 'ELE');
    void recordCheaperOffer(session.repos, {
      contract: electricity.contract,
      dataDate: ready.dataDate,
      best: best && best.savingCents >= data.settings.cheaperOfferMinSavingCents ? best : undefined,
    });
  }, [session, electricity, electricityComparison, ready, data]);

  if (!session || !data) return null;
  const hasBoth = data.electricity.length > 0 && data.gas.length > 0;
  const shown: Tab = tab === 'both' && !hasBoth ? 'electricity' : tab;

  function choose(next: Tab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Private mode: the tab is simply not remembered.
    }
  }

  async function saveGas(gasDetails: NonNullable<Contract['gas']>) {
    if (!session || !gas) return;
    await session.repos.contracts.put({ ...gas.contract, gas: gasDetails });
  }

  const missingTaxes =
    gas !== undefined && !gas.lines.some((line) => line.kind === 'tax' && line.amountCents !== 0);

  return (
    <>
      <h1>{copy.title}</h1>
      <p className="muted compare-intro">{copy.intro}</p>
      <div className="compare-tabs" role="tablist" aria-label={copy.title}>
        {(['electricity', 'gas', 'both'] as const)
          .filter((item) => item !== 'both' || hasBoth)
          .map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={shown === item}
              className="compare-tab"
              onClick={() => choose(item)}
            >
              {copy.tabs[item]}
            </button>
          ))}
      </div>
      <details className="compare-glossary">
        <summary>{copy.glossary.title}</summary>
        <dl>
          {copy.glossary.items.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{copy.glossary.source}</p>
      </details>

      {offers === null && <p role="status">{copy.loading}</p>}
      {offers === 'error' && <p className="ingest-problem">{copy.offersUnavailable}</p>}
      {ready && <p className="muted">{copy.dataDate(formatIsoDate(ready.dataDate))}</p>}

      {shown === 'electricity' && (
        <>
          {data.electricity.length === 0 && <p className="compare-note">{copy.noContract}</p>}
          {data.electricity.length > 1 && (
            <SelectField
              id="compare-contract"
              label={copy.contract}
              value={electricity?.contract.id ?? ''}
              onChange={(event) => setChosenElectricity(event.target.value)}
            >
              {data.electricity.map((item) => (
                <option key={item.contract.id} value={item.contract.id}>
                  {item.contract.label} — {item.provider?.name}
                </option>
              ))}
            </SelectField>
          )}
          {electricityComparison && electricity && (
            <ElectricitySection
              comparison={electricityComparison}
              contract={electricity.contract}
              {...(electricity.provider ? { provider: electricity.provider } : {})}
            />
          )}
        </>
      )}

      {shown === 'gas' && (
        <>
          {data.gas.length === 0 && <p className="compare-note">{copy.gas.noContract}</p>}
          {data.gas.length > 1 && (
            <SelectField
              id="compare-gas-contract"
              label={copy.contract}
              value={gas?.contract.id ?? ''}
              onChange={(event) => setChosenGas(event.target.value)}
            >
              {data.gas.map((item) => (
                <option key={item.contract.id} value={item.contract.id}>
                  {item.contract.label} — {item.provider?.name}
                </option>
              ))}
            </SelectField>
          )}
          {gas && !gasUsage && <p className="compare-note">{copy.gas.noKwh}</p>}
          {gas && gasUsage && (
            <GasSection
              comparison={gasComparison}
              contract={gas.contract}
              {...(gas.provider ? { provider: gas.provider } : {})}
              missingTaxes={missingTaxes}
              onChange={(details) => void saveGas(details)}
            />
          )}
        </>
      )}

      {shown === 'both' &&
        (both ? <BothSection comparison={both} /> : <p className="compare-note">{copy.both.needsBoth}</p>)}

      {ready && <p className="compare-disclaimer">{copy.disclaimer}</p>}
    </>
  );
}
```

Then delete `DisplayResult` and `groupDualVariants` from `src/domain/compare.ts` and their test block from `src/domain/compare.test.ts` (if not already done in Task 5).

- [ ] **Step 5: Styles (`src/features/compare/compare.css`)**

Append:

```css
/* Luz · Gás · Luz + gás */
.compare-tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0 16px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  width: fit-content;
  max-width: 100%;
}

.compare-tab {
  min-height: 40px;
  padding: 6px 16px;
  font: inherit;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.compare-tab[aria-selected='true'] {
  color: var(--accent);
  font-weight: 700;
  background: var(--accent-soft);
}

.compare-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.compare-settings {
  display: grid;
  gap: 0 16px;
  max-width: 40rem;
}

@media (min-width: 640px) {
  .compare-settings {
    grid-template-columns: 1fr 1fr;
  }
}
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Run `pnpm dev`, sign in with a local test account, open Comparar (phone width 390 px and desktop, light and dark): the three tabs (the third only with both contracts); "Gás" with no gas contract shows the explanation; with a Repsol dual invoice imported (local, from `samples/` is NOT allowed — use the app with your own invoice file, or skip and rely on the tests) the gas tab shows escalão, distributor, current cost, offers; choosing a distributor adds the regulated tariff line.

- [ ] **Step 7: Commit**

```bash
git add src/features/compare src/domain/compare.ts src/domain/compare.test.ts src/i18n/pt-PT.ts
git commit -m "feat(ui): compare gas and electricity + gas, in tabs"
```

---

### Task 7: Plan and decisions

**Files:**
- Modify: `planning/PLAN.md` (§8, Pós-MVP checkbox, §16)

- [ ] **Step 1: `planning/PLAN.md`**

- In §13 Pós-MVP, change `- [ ] Gás no comparador; telecom com lista de ofertas mantida manualmente` to `- [x] Gás no comparador (e total luz + gás; spec 2026-10-14-gas-comparator) · [ ] telecom com lista de ofertas mantida manualmente`.
- At the end of §8 add: `**Gás (2026-10-14):** ofertas GN e DUAL da ERSE por escalão; tarifa regulada por distribuidor (ORD); IVA em docs/gas-vat.md; encargos comuns da última fatura de gás; separador "Luz + gás" com a melhor combinação separada e as ofertas conjuntas.`
- In §16 add rows dated 2026-10-14:

```markdown
| 2026-10-14 | Gás no comparador e total luz + gás. Preços do mercado livre iguais em todo o país (só dependem do escalão); o distribuidor só serve para a tarifa regulada e é perguntado ao utilizador (sem tabela oficial de concelhos) |
| 2026-10-14 | IVA do gás: 6 % no termo fixo das redes (valor da fatura do utilizador) e nos descontos sobre ele, 23 % no resto (docs/gas-vat.md) |
| 2026-10-14 | Ingestão por email: sem domínio próprio, só a leitura direta do Outlook preserva a privacidade; caixa Gmail partilhada e serviços como o Brevo expõem as faturas em claro. A partilha (Web Share Target) cobre o caso manual |
```

- [ ] **Step 2: Full verification and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

```bash
git add planning/PLAN.md
git commit -m "docs(plan): gas comparator done; decisions"
```

- [ ] **Step 3: Release (ask the user first)**

Ask "Faço push?" — a push to `main` publishes app and data (CI). After the push, watch the run (`gh run watch`) and confirm the deploy.
