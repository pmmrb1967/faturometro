# Gás no comparador (e total luz + gás)

Data: 2026-10-14 · Estado: aprovado em conversa (partes 1 e 2), à espera de revisão escrita

## Objetivo

Para quem tem gás natural canalizado, a app estima o custo anual do contrato atual e mostra as ofertas de gás mais baratas da ERSE. Para quem tem luz e gás, mostra também o custo conjunto: as melhores ofertas conjuntas (DUAL) contra a melhor combinação de ofertas separadas, que podem ser de comercializadores diferentes. Tudo continua a funcionar sem IA e sem servidor: os dados da ERSE são públicos e o cálculo é feito no dispositivo.

## O que já existe

- `scripts/erse-sync.ts` descarrega o ZIP do simulador da ERSE e grava `public/data/erse-offers.json` (`schemaVersion: 1`). Hoje só guarda as ofertas de eletricidade e as conjuntas (`ELE`, `DUAL`), e só a parte da luz.
- `src/domain/electricity-cost.ts` e `src/domain/compare.ts` fazem a estimativa da luz: encargos comuns lidos das faturas do utilizador, IVA segundo `docs/electricity-vat.md`, extrapolação para um ano.
- O parser Repsol já lê faturas de gás (`sector: 'gas'`): escalão, termo fixo, energia em kWh, termo fixo das redes, taxa de ocupação do subsolo (fixa e variável), imposto especial sobre o gás natural, descontos.

## Factos confirmados (2026-10-14)

**Dados da ERSE** (ZIP público do simulador, mesmo formato de `docs/erse-data.md`):
- Ofertas por tipo e segmento: `GN/Dom` 72, `GN/Tod` 32, `DUAL/Dom` 270, `DUAL/Tod` 38 (as `Ndom` ficam de fora, como na luz).
- Preços de gás em `Precos_ELEGN.csv`: `TFGN` (termo fixo, €/dia) e `TVGN` (energia, €/kWh), sem IVA, por `Escalao` (`1`–`4`).
- A coluna `ORD` (operador da rede de distribuição) só está preenchida em 44 linhas: 11 operadores × 4 escalões, nas tarifas reguladas (ex.: oferta `CURREN`). **As ofertas do mercado livre têm o mesmo preço em todo o país**; só a tarifa regulada depende do distribuidor.
- Códigos `ORD`: `BEI`, `DIA`, `DUR`, `LIS`, `LUS`, `MED`, `PAX`, `REN`, `SET`, `SON`, `TAG`. Correspondem aos 11 operadores da lista oficial da DGEG (concessões: Beiragás, Lisboagás GDL, Lusitaniagás, REN Portgás Distribuição, Setgás, Tagusgás; licenças: Dianagás, Duriensegás, Medigás, Paxgás, Sonorgás) — <https://www.dgeg.gov.pt/pt/areas-setoriais/energia/combustiveis/concessoes-e-licencas-sng/>. A correspondência código → nome segue as iniciais; é confirmada na implementação com o `metadata.xlsx` da ERSE, se o trouxer, ou com as ofertas `CUR*` de cada código.
- Colunas de gás nas condições: `ReembTF_GN (%)`, `ReembTW_GN (%)`, `ReembW_GN (€/kWh)` (descontos para todos), `Desc. TF_GN (%) - Novo Cliente`, `Desc. TW_GN (%) - Novo Cliente`, `Desc. W_GN (€/kWh) - Novo Cliente` (só novos clientes), `ConsIni_GN`, `ConsFim_GN` (significado a confirmar no `metadata.xlsx`; se não for claro, não se usam).

**IVA do gás** (Portugal continental, consumos em baixa pressão até 10 000 m³/ano): 6 % no termo fixo da tarifa de acesso às redes; 23 % em tudo o resto (termo fixo comercial, energia, imposto especial, taxa de ocupação do subsolo). Fontes: exemplo da ERSE de 1 de outubro de 2025 (<https://www.erse.pt/media/xnvl2elt/tarifa-social-gn-2025-2026_1-outubro-2025.pdf>), CGD (<https://www.cgd.pt/Site/Saldo-Positivo/casa-e-familia/Pages/impostos-e-taxas-agua-luz-gas.aspx>), e as faturas reais da Repsol (`Redes Termo Fixo` a 6 %, o resto a 23 %). Registar em `docs/gas-vat.md`.

**Fatura de gás (Repsol)**: linhas `Termo Fixo (Escalão N)` (€/dia), `Redes Termo Fixo` (€/dia, 6 %), `Energia` (kWh × €/kWh), `Taxa Ocupação Subsolo Fixa` e `Variável` (por município), `Imposto Especial Consumo GN`, descontos (dual, débito direto, fatura eletrónica, tarifa social). O consumo vem em kWh (m³ × fator de correção × poder calorífico).

**Não encontrado:** uma tabela oficial de concelhos por distribuidor. As listas de sites comerciais contradizem-se; não se usam (regra 6). A dedução pelo município fica fora de âmbito até haver fonte oficial (provavelmente os contratos de concessão na DGEG).

## Decisões

| Decisão | Porquê |
|---|---|
| Gás + total luz e gás (opção b) | Muitas ofertas são conjuntas e o utilizador tem um contrato dual |
| Distribuidor perguntado uma vez por contrato de gás, com "Não sei" | A fatura não o traz; sem ele só falta a linha da tarifa regulada |
| Escalão lido da fatura; se faltar, perguntado (1–4) | É o que define os preços das ofertas; não se inventam limiares |
| Encargos iguais em todas as ofertas lidos da última fatura de gás | Mesmo princípio da luz (§16 do PLAN.md) |
| IVA a 6 % só no termo fixo das redes, com o valor €/dia da fatura do utilizador | Mais exato do que na luz, porque a fatura separa essa parte |
| Ofertas conjuntas saem dos separadores "Luz" e "Gás" e passam para "Luz + gás" | Lá o custo é completo; na luz deixa de existir a nota "o gás não está incluído" |

## Desenho

### 1. Dados (`scripts/erse-sync.ts`, `src/domain/erse.ts`)

`erse-offers.json` passa a `schemaVersion: 2`:

- `offer.supply`: `'ELE' | 'GN' | 'DUAL'`.
- Ofertas `ELE` e `DUAL`: `prices` (luz) como hoje.
- Ofertas `GN` e `DUAL`: novo `gasPrices: Partial<Record<'1'|'2'|'3'|'4', { fixedPerDay: number; perKwh: number }>>` (de `TFGN`, `TVGN`, linhas sem `ORD`).
- Descontos de gás: `gasDiscounts: { fixedTermPct, energyPct, energyPerKwh }` e `gasNewClientDiscounts` (mesma forma), das colunas `_GN`.
- Novo bloco no ficheiro: `regulatedGas: Record<OrdCode, Partial<Record<Escalao, { fixedPerDay, perKwh }>>>` com o nome da oferta regulada de cada distribuidor (linhas com `ORD`).
- `src/domain/gas-distributors.ts`: os 11 códigos com o nome oficial (lista da DGEG acima).
- O ficheiro só é aceite pela app com `schemaVersion: 2` (validação zod); a app e os dados são publicados juntos.

### 2. Contrato de gás

`Contract.gas?: { escalao?: 1 | 2 | 3 | 4; distributor?: OrdCode | 'unknown' }` (dentro do registo cifrado; sem novo índice, portanto sem nova versão Dexie). O escalão é preenchido pelo parser (já o lê); o distribuidor pelo utilizador.

### 3. Cálculo (`src/domain/gas-cost.ts`, `src/domain/compare-gas.ts`)

Para N dias e C kWh:

```
termo fixo da oferta     = fixedPerDay × N × (1 − desc. termo fixo %)
energia                  = C × perKwh × (1 − desc. energia %) − C × desc. €/kWh
encargos comuns (fatura) = (redes termo fixo − desc. social redes termo fixo) €/dia × N   → IVA 6 %
                         + TOS fixa €/dia × N + TOS variável €/kWh × C
                         + IEC €/kWh × C − desc. social redes energia €/kWh × C          → IVA 23 %
IVA                      = 6 % × (parte do termo fixo das redes) + 23 % × (resto)
```

- A taxa de IVA de cada linha de desconto segue a da linha que desconta (na fatura Repsol: `Desc. Social Redes Termo Fixo` a 6 %, `Desc. Social Redes Energia` a 23 %).
- Os encargos comuns saem da última fatura de gás com linhas lidas (por dia e por kWh, como `breakdownFromLines` na luz).
- **A confirmar na primeira tarefa do plano:** se o `TFGN` da ERSE já inclui o termo fixo das redes (que a fatura mostra à parte). Decide-se calculando o custo do contrato atual para o período de cada fatura real e comparando com o total: a variante certa bate com ±2 %. Fica registado em `docs/gas-vat.md`.
- Consumo anual: kWh das faturas de gás dos últimos 12 meses, extrapolado como na luz quando há menos dias.
- Custo atual: os preços da fatura (termo fixo e energia do contrato) com o mesmo cálculo.

**Luz + gás:**
- Melhor combinação separada = melhor oferta `ELE` + melhor oferta `GN` (podem ser de comercializadores diferentes).
- Ofertas conjuntas = custo da parte da luz (`prices`) + custo da parte do gás (`gasPrices`) da mesma oferta `DUAL`, cada uma com os seus descontos.
- Total atual = estimativa atual da luz + estimativa atual do gás.

### 4. Ecrã (`src/features/compare/`)

- Título "Comparar". Seletor no topo: **Luz** · **Gás** · **Luz + gás** (este só com contratos de luz e de gás). O último separador usado fica em `localStorage` (preferência do dispositivo, com `try/catch`).
- **Luz:** como hoje, sem as ofertas conjuntas (que passam para "Luz + gás").
- **Gás:** custo anual estimado; as 5 ofertas `GN` mais baratas com poupança e condições (fidelização, débito direto, fatura eletrónica, descontos só para novos clientes — não incluídos); linha de referência "Tarifa regulada (<distribuidor>)" quando o distribuidor é conhecido.
- **Cartão do distribuidor:** "Qual é o distribuidor de gás da tua zona?" com os 11 nomes e "Não sei", e uma frase sobre onde o encontrar (contrato, área de cliente). Guarda no contrato.
- **Luz + gás:** total atual; melhor combinação separada (ex.: "EDP + Galp"); as 5 melhores ofertas conjuntas com poupança face ao total atual.
- **Glossário:** escalão, distribuidor (operador da rede), tarifa regulada, taxa de ocupação do subsolo (TOS), imposto especial sobre o consumo de gás natural (IEC).
- Textos em `src/i18n/pt-PT.ts`; linguagem de "estimativa", nunca "poupança garantida".

### 5. Dados em falta

| Situação | Comportamento |
|---|---|
| Sem fatura de gás lida automaticamente | Mensagem: é precisa uma (por agora, Repsol) |
| Contrato sem escalão | Pede o escalão (1–4), explicando que vem na fatura |
| Menos de 12 meses | Extrapola, com aviso forte: "o gás varia muito entre inverno e verão; com menos de um ano, a estimativa pode falhar bastante" |
| Só m³, sem kWh | Não estima; explica que falta o fator de conversão da fatura |
| Fatura sem TOS ou IEC | Conta como zero e indica que não estão incluídos |
| Vários contratos de luz ou de gás | Escolha do contrato no topo; em "Luz + gás", junta por defeito os contratos que vêm no mesmo ficheiro (mesmo `fileHash`), com possibilidade de mudar |
| Distribuidor "Não sei" | Sem linha da tarifa regulada; o resto igual |

## Testes

- `scripts/erse/normalize.test.ts`: ofertas `GN` e `DUAL` com `gasPrices` por escalão, descontos `_GN`, `regulatedGas` por `ORD`, rejeição de cabeçalhos inesperados.
- `src/domain/gas-cost.test.ts`: termo fixo, energia, descontos, IVA 6 %/23 %, encargos comuns, arredondamento a cêntimos só no fim.
- `src/domain/compare-gas.test.ts`: ordenação, poupança, tarifa regulada por distribuidor, melhor combinação separada vs. conjuntas, extrapolação.
- `src/domain/compare-gas.real.test.ts` (só com `fixtures/private/repsol/`; saltado no CI): o custo do contrato atual para o período de cada fatura real de gás bate com o total da fatura ±2 %.

## Fora de âmbito

- Dedução do distribuidor pelo município (sem fonte oficial).
- Conversão de m³ para kWh sem o fator da fatura.
- Ofertas `Ndom` e Regiões Autónomas.
- Layouts de gás de outros fornecedores (Layouts P2).
