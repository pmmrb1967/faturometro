# Sincronização e cópias na cloud do utilizador (OneDrive primeiro)

Aprovado no chat a 2026-11-21: abordagem A (cada dispositivo escreve só os seus ficheiros) e autenticação só no browser.

## Porquê

O utilizador não quer que os seus dados dependam do servidor do Faturómetro. Por omissão, a sincronização entre dispositivos e as cópias de segurança passam a ir para uma cloud do próprio utilizador: primeiro o OneDrive, depois o Google Drive e o Dropbox. O servidor do Faturómetro (Cloudflare) continua disponível como está hoje, como última opção para quem não tem cloud, com os limites de espaço atuais.

## Objetivos

- Ligar a sincronização ao OneDrive do utilizador, como opção recomendada; o servidor do Faturómetro fica como alternativa ("espaço limitado").
- Tudo cifrado no dispositivo, como hoje: o OneDrive só guarda dados cifrados.
- No OneDrive: registos, originais (PDFs e fotos, sem o limite dos 12 meses do servidor) e cópias de segurança automáticas (também no telemóvel).
- Num dispositivo novo: entrar no OneDrive e escrever a palavra-passe da conta.
- O código da cloud separado por fornecedor, para o Google Drive e o Dropbox serem "mais um fornecedor".
- O administrador mantém o selo e as contribuições de layout sem sincronizar dados pelo servidor.
- Migrar uma conta que hoje sincroniza pelo servidor para o OneDrive, com a opção de depois apagar os dados do servidor.

## Fora de âmbito

- Google Drive e Dropbox (só a interface preparada).
- Sincronizar pelo OneDrive e pelo servidor ao mesmo tempo: um perfil usa um destino de cada vez.
- Remover da pasta os ficheiros de dispositivos que já não existem (fica para depois; não causa erros).
- Partilhar dados entre contas diferentes.
- Mudar a IA gratuita ou as contribuições de layout: continuam pelo servidor, como hoje.

## Anti-objetivos

- Qualquer dado em claro no OneDrive, ou a chave mestra sem estar embrulhada pela palavra-passe ou pela chave de recuperação.
- Perder alterações quando dois dispositivos sincronizam ao mesmo tempo.
- Passar pelo servidor do Faturómetro para falar com a Microsoft (tokens ou dados).
- Falhar em silêncio quando a ligação ao OneDrive expira: o utilizador tem de ver "Ligar de novo ao OneDrive".

## Restrições

- **Regra 1 do CLAUDE.md** passa a incluir, só quando o utilizador liga o OneDrive: `https://login.microsoftonline.com` (autenticação) e `https://graph.microsoft.com` (ficheiros), mais os anfitriões para onde a Microsoft redireciona os descarregamentos. Atualizar o CLAUDE.md, a página de privacidade e o `security-headers.ts` (`connect-src` e `frame-src` para a renovação silenciosa). Quem implementa confirma os anfitriões reais dos descarregamentos (por exemplo `*.files.1drv.com`) num teste real e lista-os de forma explícita, sem `*` genéricos a mais.
- **Registo da app no Microsoft Entra (Azure)**: gratuito; feito pelo responsável com a sua conta Microsoft. O id da aplicação (`VITE_ONEDRIVE_CLIENT_ID`) é público, não é segredo. URIs de redirecionamento: o endereço da app em produção e `http://localhost:5173` para desenvolvimento.
- **Permissão pedida**: só `Files.ReadWrite.AppFolder` (pasta `Apps/Faturómetro`) e `offline_access`. Nada fora dessa pasta.
- **Para apps web, a Microsoft limita o acesso de longa duração a 24 horas.** Depois disso, a renovação silenciosa pode falhar (cookies de terceiros bloqueados) e é preciso um clique em "Ligar de novo ao OneDrive". As alterações ficam no dispositivo até lá.
- Uma nova versão do esquema Dexie, com migração e teste, para o estado novo do perfil.
- A app tem de continuar a funcionar sem sincronização nenhuma, como hoje.

## Abordagens

1. **Cada dispositivo escreve só os seus ficheiros (escolhida).** Pequenos ficheiros de alterações numerados por dispositivo, com uma fotografia completa de vez em quando. Nunca há dois dispositivos a escrever o mesmo ficheiro, por isso não há conflitos de escrita. Envia só o que mudou e só precisa de gravar, listar e ler ficheiros, o que serve igual para o Drive e o Dropbox.
2. Um único ficheiro com a base inteira: reenvia tudo a cada alteração e tem conflitos quando dois dispositivos gravam ao mesmo tempo. Rejeitada.
3. Um ficheiro por registo: milhares de pedidos e os limites da Microsoft. Rejeitada.

Autenticação: **só no browser** (MSAL, `@azure/msal-browser`), escolhida; passar pelo servidor (autorização de 90 dias) foi rejeitado por voltar a depender dele e lhe dar acesso à pasta.

## Desenho

### Camada da cloud (por fornecedor)

Interface em `src/cloud/drive.ts`, sem nada do OneDrive:

- `CloudDrive`: `read(path) → bytes | null`, `write(path, bytes, { ifMatch? }) → { etag }`, `list(folder) → { name, size, etag }[]`, `remove(path)`, `account() → { label }` (o nome da conta Microsoft, só para mostrar).
- Erros normalizados: `needs_reconnect`, `quota_full`, `throttled` (com `retryAfter`), `conflict` (o `ifMatch` falhou), `offline`, `unexpected`.
- `src/cloud/onedrive.ts`: Microsoft Graph sobre a pasta da app (`/me/drive/special/approot`). Ficheiros até 4 MB com `PUT …:/content`; acima disso, sessão de envio. `429`/`503` respeitam `Retry-After`. Listagens com paginação.
- `src/cloud/onedrive-auth.ts`: MSAL (`PublicClientApplication`, autoridade `common`), janela (popup) no computador e redirecionamento no telemóvel; renovação silenciosa e, se falhar, o estado `needs_reconnect`.

### Organização da pasta `Apps/Faturómetro`

```
conta.json                          email + chave mestra embrulhada (palavra-passe e chave de recuperação)
dispositivos/<deviceId>/base-<n>.json   fotografia de todos os registos que este dispositivo tinha até à alteração n
dispositivos/<deviceId>/<n>.json        alterações n (registos cifrados, como os que hoje vão para o servidor)
originais/<fileHash>.bin            original cifrado, escrito uma vez
copias/                             cópias de segurança automáticas (as mesmas regras de nome e de limpeza)
```

- Os registos vão exatamente como hoje para o servidor (`OutgoingRecord`: id, tabela, `updatedAt`, `deletedAt`, `enc`), com os campos de índice já fora.
- `n` são números com zeros à esquerda (8 dígitos), por ordem.
- **Compactação**: quando um dispositivo tem mais de 50 ficheiros de alterações, escreve `base-<n>.json` com todos os registos da sua base local e só depois apaga os seus ficheiros `≤ n` e as bases antigas.
- `conta.json` é escrito na ativação; ao mudar a palavra-passe, regravado com `ifMatch` (se falhar com `conflict`, lê-se de novo e repete-se).

### Sincronizar (por perfil e dispositivo)

Estado local novo no perfil: `cloud?: { provider: 'onedrive'; deviceId; cursors: Record<deviceId, n>; nextSeq; lastSyncAt?; files?: boolean; accountLabel? }`. Um perfil tem `sync` (servidor) **ou** `cloud`, nunca os dois.

1. **Enviar**: os registos alterados desde o último envio (o mesmo `changedSince` + `pendingPush` do motor atual) vão num novo `dispositivos/<eu>/<nextSeq>.json` (ficheiros até ~1,5 MB; se for preciso, vários). Só depois de gravado com sucesso se avança `nextSeq` e o cursor de envio.
2. **Receber**: listar `dispositivos/`; para cada outro dispositivo, ler os ficheiros com `n > cursors[dispositivo]` por ordem. Se esses ficheiros já tiverem sido compactados (o cursor é anterior à base mais antiga que existe), ler a base mais recente e depois os ficheiros seguintes. Aplicar como hoje: ganha o `updatedAt` mais recente; conflitos contam-se e não param.
3. **Originais** (se ligados): enviar os que faltam em `originais/`, descarregar os que faltam localmente, com a mesma cifra do servidor.
4. Corre quando a app abre, de 5 em 5 minutos e quando a ligação volta, como a sincronização atual (`useAutoSync`).

A lógica do protocolo (o que ler, que cursores, quando compactar) fica pura e testável, sem fetch: `src/cloud/sync-protocol.ts`, sobre a interface `CloudDrive`.

### Ativar e dispositivo novo

- **Ativar** (numa conta com palavra-passe): ligar ao OneDrive → se a pasta não tiver `conta.json`, gravá-lo, escrever uma base completa e enviar os originais, se ligados. Se já tiver, e o email for o desta conta, verifica-se a palavra-passe contra ele e junta-se (sincronização normal). Se for de outra conta, recusa com uma mensagem clara.
- **Dispositivo novo** (na página de entrada, "Entrar com o OneDrive"): ligar → ler `conta.json` → pedir a palavra-passe → desembrulhar a chave mestra → criar o perfil local, como o `connectFromServer` faz hoje → primeira sincronização a partir das bases.
- Convidados: sem sincronização, como hoje.

### Cópias de segurança no OneDrive

A cópia automática passa a ter dois destinos: "Pasta neste computador" (o que já existe) ou "OneDrive" (quando a sincronização pelo OneDrive está ligada, funciona também no telemóvel). O executor (`runAutoBackup`) deixa de conhecer o File System Access diretamente: passa a usar um destino `BackupTarget { list(); write(name, bytes); remove(name) }`, com duas implementações (pasta local e OneDrive em `copias/`). Nomes, cifra, limpeza e calendário iguais. No OneDrive a escrita é atómica (o ficheiro só aparece completo), por isso não precisa do `.tmp`.

### Administrador sem sincronização de dados

- Estado novo no perfil: `adminLink?: { serverUrl; token (cifrado com a chave mestra); contributions?; checkedAt? }`.
- Nas definições do administrador: "Ligação de administrador" com email e palavra-passe; usa `/v1/login` e depois `/v1/admin/stats` (que já existem). Selo e contribuições vêm daqui quando o perfil não sincroniza pelo servidor.
- **Servidor**: `DELETE /v1/data` novo, que apaga os registos e os originais mas mantém a conta (para o administrador migrar sem perder a ligação); e a manutenção diária não apaga por inatividade as contas em `ADMIN_EMAILS`. Com testes em `server/`.

### Migrar do servidor para o OneDrive

Nas definições da sincronização, com o servidor ligado: "Mudar para o meu OneDrive" → ativa o OneDrive como acima, sem apagar nada → quando a primeira sincronização termina sem erros, desliga a sincronização pelo servidor neste dispositivo e oferece:

- "Apagar os dados do servidor agora" (para o administrador usa `DELETE /v1/data` e cria a ligação de administrador; para os outros, apaga a conta como hoje);
- "Manter no servidor por agora" (pode apagar mais tarde nas definições).

Os outros dispositivos dessa conta, na próxima sincronização pelo servidor, recebem um aviso: "Esta conta passou a sincronizar pelo OneDrive. Liga o OneDrive neste dispositivo." (o servidor responde ao pull com uma marca `movedTo: 'cloud'`, gravada no momento da migração).

### Interface

Definições → Sincronização:

```
Sincronizar entre dispositivos
(•) O meu OneDrive (recomendado)        os dados ficam numa pasta tua, cifrados
( ) Servidor do Faturómetro             espaço limitado (5 MB de registos, originais 12 meses)
[Ligar]
```

Ligado ao OneDrive: conta Microsoft, última sincronização, "Sincronizar agora", originais (sim/não), "Desligar". Quando é preciso: aviso no Início e na barra "Ligar de novo ao OneDrive" (um clique; popup). Erros: OneDrive cheio, sem ligação, Microsoft a limitar pedidos (tenta de novo sozinha).

Textos em `src/i18n/pt-PT.ts`; botões só com as classes de `buttons.css`.

### Testes

- `sync-protocol` com um `CloudDrive` em memória: dois dispositivos a enviar ao mesmo tempo (nada se perde); compactação e um dispositivo atrasado que lê a base; dispositivo novo a partir das bases; registos apagados (`deletedAt`); um ficheiro de alterações corrompido conta como erro sem parar o resto.
- Adaptador OneDrive com `fetch` falso: caminhos Graph, ficheiro acima de 4 MB pela sessão de envio, `429` com `Retry-After`, `401` → `needs_reconnect`, `507` → `quota_full`, paginação.
- Ativar e entrar num dispositivo novo: `conta.json` com outra conta é recusado; palavra-passe errada.
- `BackupTarget`: os testes atuais da cópia automática passam pela pasta local; os mesmos casos para o destino OneDrive em memória.
- Migração do perfil (Dexie) e servidor (`DELETE /v1/data`, contas de administrador poupadas).
- Teste manual com uma conta Microsoft real antes de publicar: ligar, dois dispositivos, reconectar após expirar, migração do servidor.

### Documentação

CLAUDE.md (regra 1 e stack), `planning/PLAN.md` (fase nova e decisão na secção 16), página de privacidade, `docs/` com o passo a passo do registo no Entra.

## Deixado a quem implementa

- Popup ou redirecionamento por plataforma, e o sítio exato do aviso "Ligar de novo".
- Onde o MSAL guarda a sua cache: `localStorage` (sobrevive a fechar o browser; o token só dá acesso à pasta da app, onde tudo está cifrado). Dizê-lo na página de privacidade.
- Tamanho exato dos ficheiros de alterações e o limiar de compactação (proposta: 1,5 MB e 50).
- Ordem de implementação e divisão em tarefas.
