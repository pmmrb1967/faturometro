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
- Faturas reais de gás da Repsol (fixtures privadas): `Redes Termo Fixo` e o seu desconto social a 6 %; o resto a 23 %. A fatura indica que os encargos de acesso às redes estão incluídos no total, parte no termo fixo das redes (linha própria) e parte no preço da energia.

## Termo fixo das ofertas da ERSE (`TFGN`)

**Assumido (a confirmar): o `TFGN` inclui o termo fixo das redes.**

Verificação feita a 2026-10-14 com as faturas de gás reais (junho de 2026) e os dados da ERSE de 2026-10-13:
- Fatura: termo fixo comercial 0,12 €/dia + termo fixo das redes 0,0156 €/dia (escalão 1); energia 0,101424 €/kWh.
- ERSE (preços em vigor a partir de 1 de outubro de 2026): nenhuma oferta tem o preço de energia da fatura; as ofertas do mesmo comercializador têm `TFGN` 0,1749 €/dia no escalão 1. Os preços mudaram entre junho e outubro (novas tarifas de acesso às redes a 1 de outubro), por isso a comparação direta não decide.
- Indícios a favor de "inclui": as tarifas reguladas vêm nas mesmas colunas (`TFGN`/`TVGN`) e uma tarifa regulada é integral (inclui o acesso às redes); o simulador da ERSE compara o preço final pago pelo cliente.

Efeito se a suposição estiver errada: a estimativa de cada oferta varia no termo fixo das redes (cerca de 0,016 €/dia, ou seja ~6 €/ano, mais a diferença de IVA). É igual em todas as ofertas, portanto **a ordenação das ofertas não muda**; só a poupança face ao contrato atual muda nesse valor.

Como confirmar: com uma fatura de gás emitida depois de 1 de outubro de 2026, comparar o termo fixo da fatura (comercial + redes) com o `TFGN` da mesma oferta na ERSE. Se o `TFGN` for igual só ao comercial, mudar `ERSE_GAS_FIXED_INCLUDES_NETWORK` para `false` em `src/domain/compare-gas.ts`.

## Implicações para o comparador

- Os encargos iguais em todas as ofertas (termo fixo das redes, TOS, IEC, descontos sociais) vêm da última fatura de gás do utilizador, em €/dia e €/kWh.
- O IVA a 6 % aplica-se ao termo fixo das redes (valor da fatura) e aos descontos sobre ele; tudo o resto a 23 %. Nas ofertas da ERSE, a parte das redes dentro do `TFGN` passa para os 6 %.
