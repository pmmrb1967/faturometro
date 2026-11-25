# Garantias das compras

O separador **Garantias** de Contratos guarda a garantia legal das compras: o
que se comprou, a loja, a data da entrega, o prazo e a fatura ou o talão
(cifrado, na tabela `documents`, como os originais das faturas). O código está
em `src/domain/warranty.ts` (cálculo), `src/features/warranties/` (ecrãs) e no
alerta `warranty_ending` de `src/domain/alerts.ts`.

Cada garantia mostra o estado, a linha do tempo (quanto do prazo já passou) e,
aberta, as datas importantes, os detalhes e as fontes. A avaliação completa (tipo de
vendedor, uso profissional, compras anteriores a 2022, prazos depois de
comunicar o defeito, cartas de reclamação) fica no Prazómetro.

## Regras usadas

Copiadas das regras publicadas do Prazómetro (`rules/garantia/prazo-geral.json`
e `rules/garantia/usados-prazo-reduzido.json`, incluindo os seus marcos
`rejeicao` e `fim-presuncao`, verificadas a 2026-10-20 no
Diário da República; falta revisão por jurista).

| Regra | Valor na app | Fonte |
|---|---|---|
| Prazo da garantia legal de bens novos e recondicionados | 36 meses | DL n.º 84/2021, art. 12.º, n.os 1 e 3 |
| Bem usado, com prazo reduzido por acordo | 18 meses | DL n.º 84/2021, art. 12.º, n.º 3 |
| O prazo conta a partir da **entrega** do bem, não da compra | `deliveryDate` | DL n.º 84/2021, art. 12.º, n.º 1 |
| Nos primeiros **30 dias** depois da entrega, perante um defeito, o consumidor pode pedir logo a substituição ou a devolução do dinheiro (direito de rejeição) | `REJECTION_DAYS` | DL n.º 84/2021, art. 16.º |
| O defeito que apareça nos primeiros **2 anos** depois da entrega presume-se de origem (**1 ano** com o prazo de 18 meses de um usado) | `PRESUMPTION_MONTHS` | DL n.º 84/2021, art. 13.º, n.os 1, 3 e 4 |
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

Num "Outro prazo", a app mostra só a data do fim: a lei não diz nada desses
prazos, e os 30 dias e a presunção contam-se pela garantia legal.

## Avisos

No Início, com ligação ao separador Garantias e sem contrato (`contractId`
vazio):

- `warranty_ending`: 60 dias antes do fim (`WARRANTY_ENDING_DAYS`, os 60 dias do
  primeiro alerta da regra do Prazómetro);
- `warranty_proof`: 30 dias antes de acabar a presunção do defeito
  (`PRESUMPTION_ALERT_DAYS`, o `alerta_dias_antes` do marco `fim-presuncao`).

## Fora do âmbito

As cartas de reclamação à loja: a app não as escreve nem remete para outra app.
