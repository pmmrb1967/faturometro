# Capacidade da sincronização no plano gratuito da Cloudflare

Data: 2026-10-14 · Estado: aprovado em conversa, à espera de revisão escrita

## Objetivo

A sincronização entre dispositivos nunca deve obrigar a pagar a Cloudflare. Quando o espaço aperta, quem não couber fica sem sincronização (ou sem originais antigos no servidor), mas **ninguém perde dados**: a app é local-first e os dados ficam sempre nos dispositivos. Passar para o plano pago fica para decidir mais tarde, se for preciso.

## Contexto (o que existe hoje)

- Servidor `server/` (Worker + duas bases D1, `faturometro` e `faturometro-files`), limites do plano gratuito em `planning/PLAN.md` §15b.
- No plano gratuito, ultrapassar um limite **não tem custos**: os pedidos falham (limites diários, até à meia-noite UTC) ou as escritas são recusadas (espaço).
- Originais (PDF): quota de 50 MB por conta e 450 MB no total (`FILE_QUOTA_BYTES`, `FILES_TOTAL_BYTES`). É o recurso que esgota primeiro: ~9 contas cheias, ou ~40 famílias durante um ano (~10 MB/ano cada, já com o aumento do base64).
- Registos: sem quota por conta. Não há registo de última atividade das contas.
- O servidor não conhece as datas das faturas: os originais são blocos cifrados com um id.
- Um dispositivo com a sincronização de originais ligada descarrega todos os originais do servidor (`src/sync/files.ts`); um sem ela não tem originais de outros dispositivos.

## Decisões

| Parâmetro | Valor inicial | Onde |
|---|---|---|
| Quota de originais por conta | 30 MB | `server/wrangler.toml` `[vars]` |
| Quota de originais do administrador | 100 MB | idem |
| Originais mantidos no servidor | 12 meses (administrador: sem limite) | idem |
| Quota de registos por conta | 5 MB | idem |
| Máximo de contas | 200 | idem |
| Travão à entrada | 80% de ocupação | idem |
| Inatividade até apagar a conta | 12 meses | idem |
| Alerta de ocupação | 70%, verificado semanalmente | `.github/workflows/` |
| Contas de administrador | `ADMIN_EMAILS` (lista separada por vírgulas) | segredo do Worker (`wrangler secret put`), para o email não ficar no repositório público |

Todos os valores (exceto `ADMIN_EMAILS`) são variáveis do Worker: mudam com um `wrangler deploy` do servidor, sem nova versão da app. Os valores por omissão em `server/src/app.ts` passam a ser estes; os testes injetam os seus.

## Desenho

### 1. Política por conta, dita pelo servidor

`GET /v1/files/usage` passa a devolver `{ used, quota, keepMonths }`, com `keepMonths: null` para o administrador. A app aplica o que receber; o servidor continua a impor as quotas por si (a app não é de confiança para isso).

O administrador é reconhecido pelo email da conta (comparado depois de normalizado) contra `ADMIN_EMAILS`. Vantagens: quota de originais própria, sem janela móvel, nunca apagado por inatividade, não conta para o máximo de contas nem é travado à entrada.

Contas que já ultrapassem a nova quota (30 MB) não perdem nada: só deixam de poder enviar originais até a janela móvel libertar espaço.

### 2. Janela móvel nos originais (na app)

Em cada sincronização de originais, **só num dispositivo com a sincronização de originais ligada**, depois do envio e da descarga que já existem:

1. Para cada original no servidor que o dispositivo também tem, a data de referência é a data de emissão mais recente das faturas que o usam. Um original sem faturas fica no servidor (não há data em que confiar).
2. Se for anterior a hoje − `keepMonths` meses, apaga-o. Só são candidatos os originais cuja cópia local existe: como a descarga dos originais em falta corre antes, um original que não se conseguiu descarregar nunca é apagado.
3. Apaga-o do servidor (`DELETE /v1/files/:id`, já existe) e atualiza o registo cifrado do documento com `onServer: false`, para os outros dispositivos não tentarem descarregá-lo.

Noutros dispositivos, "Abrir original" de um documento com `onServer: false` que não exista localmente mostra: "Este original já só está guardado nos dispositivos que o tinham" (texto final em `src/i18n/pt-PT.ts`).

Nas Definições (secção da sincronização), uma linha explica a regra: "Os originais com mais de 12 meses ficam só nos teus dispositivos." O número vem de `keepMonths`.

Um documento com `onServer: false` não volta a ser enviado (não entra em `localOnlyIds`).

### 3. Quota de registos por conta

- Nova coluna `users.records_bytes`: tamanho dos registos cifrados da conta, recalculado (`SUM(LENGTH(enc))`) no máximo uma vez por dia, junto com a atualização da última atividade (secção 5), para não somar todas as linhas em cada envio (o plano gratuito conta linhas lidas).
- `POST /v1/changes` recusa com **507** quando `records_bytes` + tamanho do lote > quota. A app mostra o mesmo aviso de espaço cheio que já mostra para os originais, adaptado a "registos".

### 4. Travão à entrada

`POST /v1/register` responde **503** com `{ error: "capacity" }` quando qualquer destes se verifica:

- número de contas ≥ máximo (contagem direta de todas as contas);
- originais ≥ 80% de `FILES_TOTAL_BYTES`;
- registos ≥ 80% do espaço de registos (500 MB).

Os totais de ocupação vêm da tabela `stats` (secção 6), não de uma soma em cada registo. A app mostra: "A sincronização está lotada de momento. Os teus dados continuam neste dispositivo; tenta mais tarde." Quem já sincroniza não é afetado.

Não há um pedido para a app saber a lotação antes de o utilizador tentar ativar: a regra 1 do `CLAUDE.md` só permite contactar o servidor depois de o utilizador ativar a sincronização.

### 5. Limpeza de contas inativas

- Nova coluna `users.last_seen_at` (data ISO `YYYY-MM-DD`; para as contas existentes, a data da migração). Atualizada em qualquer pedido autenticado quando a data guardada é anterior a hoje: no máximo uma escrita por conta e por dia.
- Uma tarefa agendada do Worker (Cron Trigger, diária) apaga as contas não administradoras com `last_seen_at` anterior a hoje − 12 meses: originais, registos, sessões e conta, como o `DELETE /v1/account`.
- Cada conta apagada deixa uma marca em `removed_accounts (id, removed_at)`: só o id aleatório da conta, sem email. As marcas com mais de 24 meses são apagadas pela mesma tarefa.
- `POST /v1/register` e `POST /v1/login` passam a devolver também o `accountId`, que a app guarda no estado de sincronização do perfil. Para perfis antigos sem ele, a app obtém-no num novo `GET /v1/account` (autenticado) na próxima sincronização. Um perfil antigo que nunca sincronize depois desta versão não recebe o aviso: vê o pedido de palavra-passe habitual.
- Novo `GET /v1/removed/:accountId` (sem autenticação) → `{ removed: boolean }`. Como o id é aleatório e só os dispositivos da conta o conhecem, isto não permite descobrir emails.
- Quando uma sincronização recebe 401 e o perfil tem `accountId`, a app pergunta `GET /v1/removed/:accountId`. Se a conta foi removida, a app desliga a sincronização do perfil (os dados locais ficam intactos) e mostra: "A tua conta de sincronização foi removida por inatividade. Os teus dados estão neste dispositivo; podes voltar a ativar a sincronização." Reativar é o fluxo normal de ativação, sujeito ao travão à entrada.
- A página `/privacidade` passa a explicar a remoção por inatividade e a janela de 12 meses dos originais.

### 6. Estatísticas e monitorização

- A mesma tarefa diária calcula e guarda numa tabela `stats` (uma linha): número de contas, bytes de registos, bytes de originais, data. Sem dados pessoais.
- Workflow semanal `.github/workflows/sync-capacity.yml`: lê `stats` com `wrangler d1 execute --remote` (o token `CLOUDFLARE_API_TOKEN` já tem permissão D1) e, se algum valor passar de 70% do respetivo limite, abre uma issue no repositório (ou comenta a que estiver aberta), para o GitHub avisar por email. A issue só tem percentagens e totais.

### 7. Migrações

- `server/migrations/0002_capacity.sql`: `users.last_seen_at`, `users.records_bytes`, tabelas `removed_accounts` e `stats`.
- Do lado da app, `onServer` vive dentro do registo cifrado do documento: não é preciso nova versão do esquema Dexie, salvo se for preciso indexá-lo (decidir no plano).

## Erros e casos-limite

- A descarga antes de apagar falha (rede, 404): o original não é apagado do servidor nessa sincronização.
- Dois dispositivos com originais ligados aplicam a janela ao mesmo tempo: `DELETE` é idempotente e ambos têm a cópia local.
- O relógio do dispositivo está errado: a janela usa a data do dispositivo; no pior caso apaga cedo um original que esse dispositivo tem localmente (sem perda).
- Limites diários da Cloudflare atingidos: a sincronização falha com o erro de rede que já existe e volta a funcionar no dia seguinte; nada a acrescentar.
- O administrador muda de email: perde as vantagens até `ADMIN_EMAILS` ser atualizado.

## Testes

Servidor (`server/src/app.test.ts`, relógio simulado):
- política devolvida em `/v1/files/usage` para conta normal e administrador;
- quota de originais (conta normal vs. administrador) e de registos (507);
- travão à entrada por número de contas e por ocupação (503);
- `last_seen_at` atualizado no máximo uma vez por dia;
- tarefa diária: apaga só inativos não administradores, cria marcas, limpa marcas antigas, escreve `stats`;
- `register` e `login` devolvem o `accountId`; `GET /v1/removed/:id` responde `true` só para contas removidas.

App:
- janela móvel: apaga só originais antigos, nunca sem cópia local, marca `onServer: false`, não volta a enviá-los; administrador (`keepMonths: null`) não apaga nada;
- conta removida: a sincronização desliga-se sem tocar nos dados locais;
- 503 `capacity` mostra a mensagem de lotação.

## Fora de âmbito

- Passar para o plano pago ou para R2.
- Limites aos pedidos por utilizador (o intervalo de 5 minutos fica como está; revisitar se os alertas o mostrarem).
- Notificações por email aos utilizadores.

## A confirmar na implementação

- Cron Triggers disponíveis no plano gratuito e o seu limite (documentação da Cloudflare, registar em §15b).
- Tamanho máximo de uma base D1 no plano gratuito continua 500 MB (§15b).
