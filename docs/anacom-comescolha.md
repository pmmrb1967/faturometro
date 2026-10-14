# COM.escolha (ANACOM) — ligações para comparar telecomunicações

Consultado em 2026-10-14.

## O que é

O COM.escolha é o comparador oficial de tarifários da ANACOM: <https://www.anacom.pt/tarifarios/>. Cobre pacotes (2 ou mais serviços), internet, televisão, telefone fixo e serviços no telemóvel. Os tarifários são introduzidos pelos operadores e acompanhados pela ANACOM.

Não há API, exportação nem dados abertos (nada no dados.gov.pt). Por isso a app **não lê** ofertas: abre uma pesquisa do COM.escolha já preenchida, num separador novo, só quando o utilizador carrega no botão. A app não faz pedidos à ANACOM (regra 1); o endereço leva só os serviços, o limite mensal em euros e, se o utilizador o escrever, o prefixo do código postal.

## Pesquisas

Os formulários `<Nome>Consulta.do` enviam por POST para `<Nome>ResultadosConsulta.do`, mas os mesmos parâmetros funcionam por GET numa sessão nova (testado em 2026-10-14).

| Pesquisa | Página de resultados | Código postal |
|---|---|---|
| Pacotes (2+ serviços) | `CombinadosResultadosConsulta.do` | sim |
| Internet | `InternetResultadosConsulta.do` | sim |
| Televisão | `TelevisaoResultadosConsulta.do` | sim |
| Telefone fixo | `FixoResultadosConsulta.do` | sim |
| Serviços no telemóvel | `MovelResultadosConsulta.do` | não |

Parâmetros (nomes lidos dos formulários):

- `idServico` (só pacotes, um por serviço): `1` Internet, `2` Televisão, `3` Telefone fixo, `4` Serviços no telemóvel.
- "Todos": `todosPrestadores=on`, `todasFidelizacoes=on`, e conforme a pesquisa `todasTecnologias=on` (internet) ou `todosTiposTarifarios=on` (fixo, telemóvel).
- `limiteMensal`: euros com **ponto** decimal. Com vírgula (`39,90`) o filtro é ignorado sem aviso; a app envia euros inteiros arredondados para cima.
- `codigoPostalPrefixo`: 4 dígitos; muda a cobertura (ex.: 110 pacotes de 3 serviços no país, 27 com `9900`).
- Sem resultados, a ANACOM volta ao formulário com "O COM.escolha não disponibiliza ofertas totalmente compatíveis com os requisitos que indicou".
- A ordenação (ex.: por custo médio mensal) é feita na própria página, no browser.

A configuração usada pela app está em `src/data/comescolha.json` (validada com zod em `src/domain/comescolha.ts`).

## Verificação semanal

A ANACOM bloqueia os servidores do GitHub (403 e depois sem resposta, com qualquer User-Agent; testado em 2026-10-14), por isso a verificação corre **no PC do responsável**, numa tarefa do Agendador de Tarefas do Windows. Não faz parte da app: os utilizadores não a têm.

- Registar (uma vez): `powershell -ExecutionPolicy Bypass -File scripts/comescolha-schedule.ps1` → tarefa "Faturometro COM.escolha", às terças às 10:00; com o PC desligado, corre quando ligar.
- Ensaiar sem push nem issue: `powershell -ExecutionPolicy Bypass -File scripts/comescolha-weekly.ps1 -DryRun`.
- Registo: `%LOCALAPPDATA%\faturometro-comescolha\check.log`. A tarefa trabalha num clone próprio nessa pasta, nunca na pasta de desenvolvimento.
- Precisa de Node, pnpm, Git (com acesso de escrita ao repositório) e `gh` com sessão iniciada.

O que faz (`scripts/comescolha-weekly.ps1` → `pnpm comescolha:check`):

1. Lê os 5 formulários e tira deles os nomes e valores dos parâmetros, pelos rótulos (`title`): "Internet", "Televisão", "Telefone fixo", "Serviços no telemóvel", "Euros", "Prefixo Código Postal" e as caixas "todos"/"todas".
2. Confirma que cada filtro muda os resultados: limite de 1 € (deve dar menos resultados), código postal `9900` e menos serviços (pacotes).
3. Se tudo funciona, grava em `src/data/comescolha.json` a data (`checkedAt`) e, se mudaram, os parâmetros novos (`changedAt`); faz commit e push para `main`, e o CI testa e volta a publicar a app (correção automática). Uma publicação por semana.
4. Se um rótulo mudou ou um filtro é ignorado, o ficheiro fica como estava e abre (ou comenta) a issue "Ligações ao COM.escolha deixaram de filtrar"; o GitHub avisa por email.
5. Se não conseguir verificar (sem rede, ANACOM em baixo), fica só no registo.

**Lembrete:** a conta de administrador vê um aviso na página Início quando `checkedAt` tem mais de 14 dias (PC desligado, tarefa parada, falha de rede). A app lê a data do próprio ficheiro de configuração: não faz nenhuma ligação nova.

São cerca de 20 pedidos por semana a páginas públicas, um de cada vez.

## Serviços do contrato

Os serviços vêm da fatura quando o parser os lê (NOS: bloco "Informação sobre o seu pacote" e linhas do resumo) e ficam marcados como "lidos da fatura" até o utilizador os confirmar na página do contrato. Enquanto não são confirmados, a fatura mais recente atualiza-os.
