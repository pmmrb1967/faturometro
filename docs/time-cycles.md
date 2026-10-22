# Períodos horários (ciclos de contagem) — Portugal continental, BTN

Consultado em **2026-10-22**, no projeto irmão Wattómetro (de onde vieram este documento e os dados). Dados usados pela app: `src/data/time-cycles.json` (lidos por `src/domain/time-cycles.ts`), para dividir os consumos a 15 minutos da E-Redes (`docs/eredes-xlsx.md`).

## Fontes

1. **ERSE, calculadora "Calculadora Fatura BTN" da Consulta Pública n.º 137** (última atualização 31 de julho de 2026): <https://www.erse.pt/media/4bacsvfi/calculadora_fatura_btn_encerramento-cp-137.xlsx>. A folha `ciclos` traz, para cada um dos 35 040 quartos de hora de 2025, o período do **mapa vigente** e do **novo mapa**, no ciclo diário e no semanal (códigos `HP` ponta, `HC` cheias, `HVN` vazio normal, `HSV` super vazio). **É a fonte dos valores da app.**
   - Nessa folha, os dias de verão estão na hora de inverno (hora legal − 1 h): a ponta da manhã do ciclo diário de verão aparece às 9:30–12:00 em vez de 10:30–13:00. Os mapas abaixo foram convertidos para **hora legal** (desviando 4 quartos de hora nos dias de verão) e conferidos com as fontes 2, 3 e 4.
2. **ERSE, "Períodos horários na energia elétrica em Portugal"**, setembro 2020: <https://www.erse.pt/media/wijn0vgt/periodos-horários-de-energia-elétrica-em-portugal.pdf> (gráficos, em hora legal).
3. **Diretiva ERSE n.º 3/2026**, Diário da República, 2.ª série, n.º 160, de 19-08-2026 — aprova os novos períodos horários: <https://www.erse.pt/media/3hanbooq/diretiva-nº-3_2026-19-de-agosto-aprova-os-períodos-horários.pdf>; retificada pela Declaração de Retificação n.º 889/2026/2, de 19-10-2026: <https://www.erse.pt/media/wxjme3wb/dr-889_2026_2-periodos-horários.pdf>. Os mapas da Diretiva são imagens; o texto define as regras gerais (abaixo).
4. **ERSE, "12 Perguntas & 12 Respostas — Eletricidade com novos períodos horários"**, 31-07-2026: <https://www.erse.pt/media/2b1dv31d/cp137_fecho_ersexplica_pr_horarios.pdf>, e o comunicado de 31-07-2026: <https://www.erse.pt/media/4kply050/comunicado_novos-períodos-horários.pdf>.
5. Página ERSE "Tarifas e preços — eletricidade" (atualizada a 22/10/2026): <https://www.erse.pt/atividade/regulacao/tarifas-e-precos-eletricidade>.

## Regras gerais

- Em BTN (até 41,4 kVA) há três opções: **simples** (um preço), **bi-horária** (vazio e fora de vazio) e **tri-horária** (ponta, cheias e vazio).
- Dois ciclos: **diário** (iguais todos os dias do ano) e **semanal** (dias úteis, sábados e domingos diferentes). Ambos distinguem **hora legal de verão** e **de inverno**, exceto o novo ciclo diário, que é igual todo o ano.
- **Vazio** inclui o vazio normal e o super vazio; **fora de vazio** inclui a ponta e as cheias (Diretiva 3/2026, art. 2.º, n.ºs 8 e 9). Por isso a app guarda um só mapa por ciclo (ponta / cheias / vazio) e deriva o bi-horário dele. Confirmado nos gráficos da fonte 2: os mapas bi-horários são exatamente o tri-horário com ponta + cheias = fora de vazio.
- **Feriados:** a regra "feriado = domingo" só se aplica a MAT, AT e MT (Diretiva 3/2026, art. 2.º, n.º 10). Em BTN um feriado segue o dia da semana. Confirmado na fonte 1: 1 de janeiro de 2025 (quarta-feira) tem o mapa de dia útil.
- **Verão / inverno** = hora legal em Portugal continental (Europe/Lisbon): verão do último domingo de março ao último domingo de outubro. A app usa o desvio horário do próprio instante.
- Todas as fronteiras são múltiplos de 15 minutos: os quartos de hora da E-Redes classificam-se sem partir intervalos.

## Mapa vigente (`pre-2027`)

Em vigor até à reparametrização do contador de cada casa (ver calendário abaixo).

### Ciclo diário (todos os dias)

| | Vazio | Cheias | Ponta |
|---|---|---|---|
| Inverno | 22:00–08:00 | 08:00–09:00, 10:30–18:00, 20:30–22:00 | 09:00–10:30, 18:00–20:30 |
| Verão | 22:00–08:00 | 08:00–10:30, 13:00–19:30, 21:00–22:00 | 10:30–13:00, 19:30–21:00 |

Bi-horário diário: vazio 22:00–08:00 todo o ano.

**Diferença entre fontes:** no gráfico de 2020 (fonte 2), a ponta da manhã de inverno parece começar às 8:30; a calculadora de 2026 (fonte 1) e a página da ERSE (fonte 5: "Cheias 08:00 - 09:00", "Ponta 09:00 - 10:30") dizem **9:00**. A app usa 9:00.

### Ciclo semanal

| | Dia útil | Sábado | Domingo |
|---|---|---|---|
| Inverno | vazio 00:00–07:00; cheias 07:00–09:30, 12:00–18:30, 21:00–24:00; ponta 09:30–12:00, 18:30–21:00 | vazio 00:00–09:30, 13:00–18:30, 22:00–24:00; cheias 09:30–13:00, 18:30–22:00 | vazio todo o dia |
| Verão | vazio 00:00–07:00; cheias 07:00–09:15, 12:15–24:00; ponta 09:15–12:15 | vazio 00:00–09:00, 14:00–20:00, 22:00–24:00; cheias 09:00–14:00, 20:00–22:00 | vazio todo o dia |

## Novo mapa (`2027`)

Diretiva 3/2026. Mesmas durações de cada período; muda a localização.

### Ciclo diário (todo o ano, sem verão/inverno)

Vazio 22:30–08:30; cheias 08:30–17:30, 21:30–22:30; ponta 17:30–21:30.

### Ciclo semanal

| | Dia útil | Sábado | Domingo |
|---|---|---|---|
| Inverno | cheias 00:00–00:30, 07:30–17:00, 22:00–24:00; vazio 00:30–07:30; ponta 17:00–22:00 | vazio 00:00–17:00; cheias 17:00–24:00 | vazio todo o dia |
| Verão | cheias 00:00–00:30, 07:30–19:30, 22:30–24:00; vazio 00:30–07:30; ponta 19:30–22:30 | vazio 00:00–17:00; cheias 17:00–24:00 | vazio todo o dia |

Conferido com a fonte 4: vazio bi-horário diário 22:30–08:30; semanal nos dias úteis a partir das 0:30 até às 7:30; sábado fora de vazio 17:00–00:00; ponta a terminar às 21:30 (diário), 22:00 (semanal, inverno) e 22:30 (semanal, verão).

### Quando muda

Diretiva 3/2026, art. 3.º: em BTN bi e tri-horário, por reparametrização do contador **entre 1 de julho e 31 de dezembro de 2027** (metas: 64 % até 31/08, 91 % até 30/09); em BTN simples, entre 1 de novembro de 2027 e 31 de março de 2030. O operador de rede informa cada cliente da data. A data é por casa, por isso o mapa é uma escolha do tarifário da casa (por defeito o vigente), e não uma data fixa nos dados.

Nos contratos do mercado livre, o comercializador pode ter períodos próprios para a componente de energia (fonte 4, pergunta 8). A app assume que seguem os da ERSE.

## Fora do âmbito por agora

Açores e Madeira têm mapas próprios (fonte 2, secções 3 e 4). Só Portugal continental está nos dados.
