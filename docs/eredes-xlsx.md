# Exportação de consumos da E-Redes (Balcão Digital)

Formato observado num ficheiro real exportado em 2026-10-22, no projeto irmão Wattómetro (de onde vieram este documento e o leitor). O ficheiro real nunca entra no repositório; os testes com ficheiros reais procuram-nos em `fixtures/private/eredes/` (ignorada pelo Git) e saltam-se se não existirem. Consultado em 2026-10-22.

## Como se obtém

Balcão Digital da E-Redes → "Consultar histórico" → consumos a 15 minutos, estado "real e estimado" → exportar. O pedido fica em fila e o ficheiro chega **até 24 h depois** (notificação no portal). Um pedido devolveu 12 meses: do dia seguinte à data de fim, um ano antes, até ao dia anterior ao pedido.

## Ficheiro

- **`.xlsx`** (não CSV), nome `Consumos_<CPE>_<início>_<fim>_<AAAAMMDDhhmmss>.xlsx`.
- Uma folha, `Dados de Energia`. Todas as células são **texto** (`t="inlineStr"`, sem `sharedStrings`), incluindo datas e números.
- Linhas 1–6: `Dados Globais`; `CPE`; `Data de Início` (`AAAA-MM-DD`); `Data de Fim`; `Intervalo` (`15 min`).
- Linha 8: cabeçalho `Contador | Data | Hora | Consumo registado, Ativa (kW) | Estado`.
- Linha 9 em diante: uma linha por quarto de hora.

| Coluna | Exemplo | Notas |
|---|---|---|
| Contador | `000002250053702` | número do contador (dado pessoal: não guardar no repositório) |
| Data | `2025/10/23` | `AAAA/MM/DD`, hora legal de Lisboa |
| Hora | `00:15` | `hh:mm`, **fim** do intervalo (ver abaixo) |
| Consumo registado, Ativa (kW) | `0,332` | **potência média** do quarto de hora, em kW, vírgula decimal, 0 a 3 casas |
| Estado | `Real` | `Real`, `Estimada` ou `-` |

## Interpretação

- **A hora marca o fim do intervalo.** O primeiro valor do ficheiro é `00:15` do dia de início e o último é `00:00` do dia seguinte ao fim; a linha `2025/10/26 00:00` é o quarto de hora 23:45–24:00 de 25/10. Convenção aplicada em `src/lib/lisbon-time.ts`.
- **Energia:** Wh = kW × 250 (kW × 0,25 h × 1000). Todos os valores observados são múltiplos de 0,004 kW, ou seja, Wh inteiros: a conversão é exata (o contador regista Wh por quarto de hora).
- **Mudança da hora:**
  - Dia de 23 h (2026-03-29): 92 valores; depois de `00:45` vem `02:00` (o quarto de hora que acaba às 01:00 de inverno = 02:00 de verão), seguido de `02:15`.
  - Dia de 25 h (2025-10-26): **só 96 valores**, sem etiquetas repetidas: a hora repetida (01:00–02:00) aparece uma só vez e faltam 4 quartos de hora. A app atribui as etiquetas ambíguas à **primeira** ocorrência (hora de verão) e deixa as outras 4 em falta; a energia perdida é a de uma hora de madrugada.
- **Estado:**
  - `Estimada`: valores que a E-Redes estimou (falha de comunicação do contador).
  - `-`: sem estado indicado (observado num dia que também tinha estimativas); tratado como estimado.
  - Num ano: 99,5 % reais.
- **Coerência com a fatura:** a soma de um período de faturação (31 dias) ficou a menos de 1 kWh das leituras da fatura do comercializador, que são inteiras.

## Na app

- Opcional, na página de cada contrato de luz, com os passos para pedir o ficheiro (`src/features/consumption/EredesSection.tsx`).
- O leitor corre no browser (`src/features/consumption/eredes.ts`): descomprime o `.xlsx` com `fflate`, lê o XML da folha e valida cada linha com zod. Rejeita ficheiros com outro cabeçalho, outra unidade ou sem CPE, e ficheiros de outro CPE que não o do contrato (se o contrato não tiver CPE, fica com o do ficheiro).
- **Os quartos de hora não são guardados.** `src/domain/consumption-profile.ts` soma-os por dia de Lisboa: total, energia estimada e divisão por vazio / cheias / ponta em cada ciclo (diário e semanal) e em cada mapa (vigente e o de 2027, `docs/time-cycles.md`). Fica um registo por CPE na tabela `consumptionProfiles` (cerca de 90 KB por ano), cifrado e sincronizado como o resto; um ficheiro novo substitui o anterior. O número do contador não é guardado.
- O comparador usa o perfil quando há pelo menos 330 dias nos últimos 365 (escalado para um ano); senão, usa as leituras das faturas. Com o perfil, compara todas as opções horárias, e nas bi e tri-horárias escolhe o ciclo (diário ou semanal) mais barato para o consumo. O utilizador escolhe os horários atuais ou os de 2027; o alerta de oferta mais barata usa só os atuais.
