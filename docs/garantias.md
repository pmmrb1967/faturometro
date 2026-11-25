# Garantias das compras

O separador **Garantias** de Contratos guarda a garantia legal das compras: o
que se comprou, a loja, a data da entrega, o prazo e a fatura ou o talão
(cifrado, na tabela `documents`, como os originais das faturas). O código está
em `src/domain/warranty.ts` (cálculo), `src/features/warranties/` (ecrãs) e no
alerta `warranty_ending` de `src/domain/alerts.ts`.

Só o essencial: prazo, documento e aviso. A avaliação completa (tipo de
vendedor, uso profissional, compras anteriores a 2022, prazos depois de
comunicar o defeito, cartas de reclamação) fica no Prazómetro.

## Regras usadas

Copiadas das regras publicadas do Prazómetro (`rules/garantia/prazo-geral.json`
e `rules/garantia/usados-prazo-reduzido.json`, verificadas a 2026-10-20 no
Diário da República; falta revisão por jurista).

| Regra | Valor na app | Fonte |
|---|---|---|
| Prazo da garantia legal de bens novos e recondicionados | 36 meses | DL n.º 84/2021, art. 12.º, n.os 1 e 3 |
| Bem usado, com prazo reduzido por acordo | 18 meses | DL n.º 84/2021, art. 12.º, n.º 3 |
| O prazo conta a partir da **entrega** do bem, não da compra | `deliveryDate` | DL n.º 84/2021, art. 12.º, n.º 1 |
| Aplica-se a compras de consumidores a profissionais a partir de 1 de janeiro de 2022 | dito no texto do separador | DL n.º 84/2021, art. 2.º, als. g) e o), e art. 53.º |

Fonte: [Decreto-Lei n.º 84/2021, de 18 de outubro](https://diariodarepublica.pt/dr/detalhe/decreto-lei/84-2021-172938301).

A contagem é em meses corridos: o mesmo dia, 36 (ou 18) meses depois; num mês
mais curto, o último dia (entregue a 29-02-2024, termina a 28-02-2027).

O utilizador pode escolher **outro prazo** em meses (por exemplo, uma garantia
comercial da marca). A app não sabe se esse prazo é legal: usa-o como está.

## O que a app não faz

- Não soma os acréscimos do prazo: a suspensão entre a comunicação do defeito e
  a reparação (art. 12.º, n.º 4) e os 6 meses por cada reparação, até 4
  (art. 18.º, n.º 4). A data mostrada é a mais cedo possível.
- Não verifica se o vendedor é profissional nem se a compra é para uso pessoal.
- Não calcula as garantias de imóveis nem de obras, que o diploma trata à
  parte: para estas, o utilizador escolhe "Outro prazo".

## Aviso

60 dias antes do fim (`WARRANTY_ENDING_DAYS`, os 60 dias do primeiro alerta da
regra do Prazómetro), aparece no Início um alerta que leva ao separador
Garantias. Não está ligado a um contrato (`contractId` vazio).
