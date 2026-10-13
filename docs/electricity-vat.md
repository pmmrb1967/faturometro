# IVA na fatura de eletricidade

Fonte: **ERSE, "ERSExplica – Aplicação do IVA na fatura de eletricidade", fevereiro 2025** — <https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf> (base legal citada: Lei n.º 38/2024, de 7 de agosto; em vigor desde 1 de janeiro de 2025). Consultado em 2026-10-13.

As regras são iguais no mercado regulado e no liberalizado.

## Portugal continental

| Componente | ≤ 3,45 kVA (1,15 / 2,3 / 3,45) | 4,6 – 6,9 kVA (4,6 / 5,75 / 6,9) | ≥ 10,35 kVA |
|---|---|---|---|
| Termo fixo da **tarifa de acesso às redes** (parte da potência) | 6 % | 23 % | 23 % |
| Termo de potência (restante) | 23 % | 23 % | 23 % |
| Energia até 200 kWh por 30 dias (300 kWh para famílias numerosas) | 6 % | 6 % | 23 % |
| Energia acima desse limiar | 23 % | 23 % | 23 % |
| Contribuição para o Audiovisual (CAV) | 6 % | 6 % | 6 % |
| Restantes componentes | 23 % | 23 % | 23 % |

Açores: 4 % / 16 %. Madeira: 5 % / 22 % (mesma estrutura).

**Limiar proporcional aos dias faturados:** kWh a taxa reduzida = (dias faturados / 30) × 200 (ou 300).

## Confirmação com faturas reais

Numa fatura Repsol de 6,9 kVA com 31 dias e 226 kWh: 207 kWh a 6 % (31/30 × 200 = 206,7 → 207) e 19 kWh a 23 %; o desconto social e o financiamento da tarifa social por kWh seguem a mesma divisão; a CAV a 6 %; a potência, a taxa DGEG e o resto a 23 %. O IVA calculado assim bate com o da fatura.

## Implicações para o comparador

- Os preços das ofertas da ERSE são **sem IVA** (ver `docs/erse-data.md`): o IVA é calculado pela app com estas regras.
- Para ≤ 3,45 kVA, a parte do termo fixo que é tarifa de acesso às redes leva 6 %, mas o CSV da ERSE não separa essa parte do preço da oferta: a app aplica 23 % a todo o termo fixo e avisa que, nessas potências, a estimativa fica ligeiramente acima.
- O estatuto de família numerosa (300 kWh) é uma definição do utilizador.
