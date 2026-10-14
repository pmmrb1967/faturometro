# ERSAR — tarifários da água

Consultado em 2026-10-14. Objetivo: ver se a app pode comparar o tarifário da água do concelho do utilizador com o de outros concelhos.

## O que existe

**Índice de tarifários por concelho** (página "Encargos tarifários → Pesquisa por concelho", `www.ersar.pt/pt_consumidor_tarifas-dos-servicos_encargos-tarifarios_pesquisa-por-concelho_ano.html`):

- A página lê `https://www.ersar.pt/docs/pesquisa-tarifa-concelho/tarifa-concelho.json`: 2331 registos `{Ano, Concelho, Entidade gestora, Servico (AA, AR ou RU), Tarifário, Ficheiro}` para 2024, 2025 e 2026 (673 registos em 2026) e 278 concelhos.
- `Ficheiro` é um PDF no armazenamento da ERSAR (`ersarwebsitedocsstorage.blob.core.windows.net/.../2026_<Concelho>_<Entidade>_<Serviço>_FT_<n>.pdf`).
- **Os PDFs são os documentos de cada entidade gestora, sem formato comum.** Por exemplo: uma tabela (Abrantes), um edital camarário com artigos (Évora), um folheto comercial com quota de serviço mensal por calibre (EPAL) e um tarifário com escalões em €/m³ e tarifa de disponibilidade em €/dia (Porto). Os escalões, as unidades (€/dia ou €/mês) e os encargos adicionais (adicional municipal, TRH, TGR) também mudam de um para outro. Não há valores em formato de dados.
- O texto da página diz que os encargos se referem a "um consumo de 10 m³/mês", mas a página só mostra as ligações para os PDFs, sem valores.

**IQS, indicadores da qualidade do serviço** (`indicadores-aqs.ersar.pt`, ERSAR Dados+, lançado a 2026-09-15; dados de 2024):

- API JSON pública (`/api/v1/initapp`, `/get-indicators`, `/get_city_values`, `/indicator_ranking`, `/compare_indicator`).
- O indicador "AA02b — Acessibilidade económica do serviço" está em **% do rendimento** (ex.: Moita 0,12 %), não em euros. Não serve para estimar quanto se pagaria noutro concelho.

**Tarifas entre entidades gestoras** ("em alta"): preços cobrados entre entidades (ex.: €/m³ da Águas do Vouga), não o que as famílias pagam.

**Direitos de autor** (Avisos legais, III): os conteúdos podem ser copiados ou distribuídos com referência ao original em www.ersar.pt e a nota "© ERSAR AAAA. Todos os direitos reservados." Os PDFs dos tarifários são documentos das entidades gestoras (conteúdos de terceiros).

## Conclusão

- Não há dados abertos com os valores dos tarifários das famílias. Comparar concelhos exigiria transcrever à mão cerca de 280 documentos por ano, em formatos diferentes, com risco de erro (regra 6 do `CLAUDE.md`).
- A comparação também teria pouca utilidade: na água não se pode mudar de fornecedor.
- O que se pode fazer com o que existe: ligar ao tarifário oficial (PDF) do concelho do utilizador, a partir de uma cópia do índice, e às páginas da ERSAR sobre tarifários sociais e para famílias numerosas.
