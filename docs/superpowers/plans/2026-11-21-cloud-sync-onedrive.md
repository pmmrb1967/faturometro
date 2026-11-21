# Sincronização e cópias no OneDrive: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar os dispositivos e guardar as cópias numa pasta da app no OneDrive do utilizador (opção recomendada), mantendo o servidor do Faturómetro como alternativa, com uma camada de cloud pronta para outros fornecedores.

**Architecture:** Interface `CloudDrive` (gravar, ler, listar, apagar) com uma implementação Microsoft Graph e uma em memória para os testes. Protocolo puro em `src/cloud/sync-protocol.ts`: cada dispositivo escreve os seus ficheiros de alterações numerados e uma base de vez em quando; os outros leem por cursor. A recolha e a aplicação de registos são extraídas do motor atual (`src/sync/engine.ts`) e partilhadas. Autenticação MSAL por redirecionamento, só no browser.

**Tech Stack:** React 18, TypeScript strict, Dexie, zod, WebCrypto, `@azure/msal-browser` (versão exata), Microsoft Graph v1.0, Vitest + fake-indexeddb; servidor Cloudflare Workers + D1.

**Spec:** `docs/superpowers/specs/2026-11-21-cloud-sync-onedrive-design.md`

## Global Constraints

- Código e comentários em inglês; texto visível em português europeu ("tu") só em `src/i18n/pt-PT.ts`. Sem `any`. Botões só com as classes de `buttons.css`; cores só por tokens.
- Nada em claro no OneDrive: registos como `OutgoingRecord` (já cifrados), originais como `encBytes` (já cifrados), `conta.json` só com a chave embrulhada (`WrappedMasterKey`) e o email.
- Permissões Microsoft: só `Files.ReadWrite.AppFolder` e `offline_access`. Autoridade `https://login.microsoftonline.com/common`. Id da app em `import.meta.env.VITE_ONEDRIVE_CLIENT_ID`; sem ele, a opção OneDrive não aparece.
- Pasta: `/me/drive/special/approot`. Caminhos: `conta.json`, `dispositivos/<deviceId>/<n 8 dígitos>.json`, `dispositivos/<deviceId>/base-<n 8 dígitos>.json`, `originais/<documentId>.bin`, `copias/<nome da cópia automática>`.
- Ficheiros de alterações até 1 500 000 bytes; compactar quando um dispositivo tiver mais de 50.
- Um perfil tem `sync` (servidor) **ou** `cloud`, nunca os dois.
- Dexie: os campos novos do perfil são opcionais e não indexados, por isso **não** há versão nova do `profilesDb` (ver Ruling na Tarefa 3).
- Servidor: nova migração `server/migrations/0006_moved.sql`; nunca alterar migrações existentes.
- Antes de cada commit: `pnpm typecheck && pnpm lint && pnpm test` (o `eredes.test.ts` com ficheiro real pode exceder o tempo com a suite inteira; é anterior e conta como conhecido). Servidor: `pnpm vitest run server`. Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push.

## Review Focus

1. Dois dispositivos sincronizam ao mesmo tempo e um terceiro chega depois: nenhum registo se perde e o terceiro vê os dois. Teste na Tarefa 2.
2. Um dispositivo esteve desligado meses e entretanto o outro compactou (apagou ficheiros que o primeiro ainda não leu): tem de ler a base. Teste na Tarefa 2.
3. Um envio falha a meio (rede, OneDrive cheio): `nextSeq` e o cursor de envio não avançam, e a próxima sincronização reenvia, sem buracos na numeração. Teste na Tarefa 2.
4. A ligação à Microsoft expirou: a sincronização e a cópia param com `needs_reconnect` visível, sem perder alterações locais, e retomam depois de "Ligar de novo". Teste na Tarefa 7.
5. `conta.json` de outra conta na mesma pasta do OneDrive (outra pessoa da casa usa o mesmo OneDrive): ativar recusa, não mistura dados. Teste na Tarefa 3.

---

### Task 1: Interface da cloud e drive em memória

**Files:**
- Create: `src/cloud/drive.ts`, `src/cloud/memory-drive.ts`
- Test: `src/cloud/memory-drive.test.ts`

**Interfaces:**
- Produces:
  - `interface CloudEntry { name: string; size: number; etag: string }`
  - `interface CloudDrive { read(path: string): Promise<Uint8Array | null>; write(path: string, bytes: Uint8Array, options?: { ifMatch?: string; ifNoneMatch?: '*' }): Promise<{ etag: string }>; list(folder: string): Promise<CloudEntry[]>; remove(path: string): Promise<void>; account(): Promise<{ label: string }> }` (`list` de uma pasta que não existe → `[]`; `remove` de um ficheiro que não existe não falha)
  - `type CloudErrorCode = 'needs_reconnect' | 'quota_full' | 'throttled' | 'conflict' | 'offline' | 'unexpected'`
  - `class CloudError extends Error { code: CloudErrorCode; retryAfterSeconds?: number }`
  - `class MemoryDrive implements CloudDrive` (etag muda a cada escrita; `ifMatch` errado → `CloudError('conflict')`; `failNext(code)` para os testes)
  - `readJson<T>(drive, path, schema: z.ZodType<T>): Promise<T | null>` e `writeJson(drive, path, value, options?)` em `drive.ts`

- [ ] **Step 1:** Testes: escrever e ler; `list('dispositivos/a')` só devolve os nomes dessa pasta (sem subpastas), com `size`; `ifMatch` com etag antigo → `conflict`; `ifNoneMatch: '*'` num ficheiro que existe → `conflict`; `failNext('quota_full')` faz a próxima escrita falhar e a seguinte passar; `readJson` com JSON inválido para o schema → lança `CloudError('unexpected')`.
- [ ] **Step 2:** `pnpm vitest run src/cloud/memory-drive.test.ts` → FAIL
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(cloud): cloud drive interface and in-memory drive`

### Task 2: Protocolo de sincronização por ficheiros

**Files:**
- Modify: `src/sync/engine.ts` (extrair, sem mudar o comportamento)
- Create: `src/cloud/sync-protocol.ts`
- Test: `src/cloud/sync-protocol.test.ts` (e os testes atuais de `src/sync/` continuam verdes)

**Interfaces:**
- Consumes: Task 1.
- Produces (em `engine.ts`, usados pelo `syncNow` atual e pelo protocolo):
  - `collectOutgoing(repos: Repositories, lastPushedAt: string): Promise<{ records: OutgoingRecord[]; pending: PendingPush[] }>`
  - `applyIncoming(repos: Repositories, records: readonly IncomingRecord[]): Promise<{ received: number; conflicts: number }>` com `IncomingRecord = Omit<RemoteRecord, 'seq'>` (trata `documents` como hoje)
- Produces (em `sync-protocol.ts`):
  - `interface CloudSyncState { deviceId: string; nextSeq: number; lastPushedAt: string; cursors: Record<string, number> }`
  - `cloudSync(repos, drive: CloudDrive, state: CloudSyncState): Promise<{ state: CloudSyncState; pushed: number; received: number; conflicts: number }>`: envia (`dispositivos/<eu>/<nextSeq>.json` com `{ format: 'faturometro-changes', version: 1, device, seq, records }`, partido em ficheiros até 1 500 000 bytes); só depois de todas as escritas avança `nextSeq`, `lastPushedAt` e limpa o `pendingPush`; recebe dos outros dispositivos por cursor; se `cursors[d]` for menor que a base mais antiga de `d` e faltarem ficheiros, lê `base-<n>` mais recente e depois os seguintes; compacta os próprios quando houver mais de 50 (escreve `base-<n>.json` com todos os registos locais, por `encryptedRow` de cada tabela de `SYNCED_TABLES` e os metadados de `documents`, e só depois apaga os seus `≤ n` e bases antigas).
  - `bootstrapState(deviceId: string): CloudSyncState` (`nextSeq: 1`, cursores vazios)

- [ ] **Step 1: Testes** com duas `ProfileDb` (repos A e B, a mesma chave mestra) e uma `MemoryDrive`:
  - A cria um fornecedor; `cloudSync(A)`; `cloudSync(B)` → B tem o fornecedor
  - A e B alteram registos diferentes e sincronizam ambos; C (terceira base) sincroniza → tem os dois
  - o mesmo registo alterado em A (mais recente) e em B → ganha o mais recente nos três
  - registo apagado (`deletedAt`) em A chega a B como apagado
  - A faz 51 envios → existe `base-00000051.json` e nenhum ficheiro `≤ 51` de A; B, que só tinha lido até 3, fica igual a A
  - `failNext('quota_full')` no envio → lança `CloudError`; `state` devolvido pela chamada anterior não muda; na chamada seguinte o mesmo `nextSeq` é usado e B recebe tudo
  - um ficheiro de alterações de B com JSON inválido → conta como conflito/erro desse ficheiro, o resto aplica-se e o cursor desse dispositivo não passa dele
  - os testes de `src/sync/sync.test.ts` passam sem mudanças
- [ ] **Step 2:** `pnpm vitest run src/cloud/sync-protocol.test.ts src/sync` → FAIL (só os novos)
- [ ] **Step 3:** Extrair `collectOutgoing`/`applyIncoming` do `syncNow` e implementar o protocolo.
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(cloud): file-based sync protocol, one writer per folder`

### Task 3: Conta na cloud, ativar e dispositivo novo

**Files:**
- Modify: `src/db/profiles.ts` (`Profile.cloud?: ProfileCloud`, `Profile.adminLink?: AdminLink`)
- Create: `src/cloud/cloud-account.ts`
- Test: `src/cloud/cloud-account.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `unlockWithPassword`, `rewrapWithPassword`, `wrappedKeyOf`, `profilesDb`.
- Produces:
  - `interface ProfileCloud extends CloudSyncState { provider: 'onedrive'; accountLabel?: string; lastSyncAt?: string; files?: boolean }`
  - `interface AdminLink { serverUrl: string; token: EncryptedBlob; contributions?: number; checkedAt?: string }`
  - `type CloudAccountErrorCode = 'other_account' | 'wrong_password' | 'no_account' | 'email_taken_locally'`
  - `enableCloudSync({ profile, masterKey, password, drive, provider }): Promise<Profile>`: verifica a palavra-passe; sem `conta.json` grava-o (`{ format: 'faturometro-cloud-account', version: 1, email, wrappedKey }`, `ifNoneMatch: '*'`); com `conta.json` de outro email → `other_account`; grava `cloud` com `bootstrapState(crypto.randomUUID())` e remove `sync` do perfil não é feito aqui (é a migração, Tarefa 10).
  - `connectFromCloud({ drive, password, provider }): Promise<{ profile: Profile; masterKey: CryptoKey }>`: lê `conta.json` (sem ele → `no_account`); email já local → `email_taken_locally`; desembrulha com a palavra-passe (errada → `wrong_password`); cria o perfil com `rewrapWithPassword` (sal local novo, como `connectFromServer`) e `cloud` novo.
  - `rewrapCloudAccount({ drive, wrappedKey, email })`: regrava `conta.json` com `ifMatch`; em `conflict` lê e repete uma vez. Chamado depois de `changePassword` quando o perfil tem `cloud`.

- [ ] **Step 1: Testes:** ativar numa drive vazia grava `conta.json` sem nada em claro além do email; ativar de novo com a mesma conta junta; `conta.json` de outro email → `other_account`; palavra-passe errada → `wrong_password`; `connectFromCloud` cria um perfil que abre com a palavra-passe e cuja chave mestra decifra um registo enviado pelo primeiro dispositivo; email já local → `email_taken_locally`; `rewrapCloudAccount` depois de mudar a palavra-passe → `connectFromCloud` com a nova funciona e com a antiga dá `wrong_password`.
- [ ] **Step 2:** `pnpm vitest run src/cloud/cloud-account.test.ts` → FAIL
- [ ] **Step 3:** Implementar. Ruling a registar: sem nova versão Dexie, porque os campos não são indexados.
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `feat(cloud): cloud account file, enable and sign in on a new device`

### Task 4: Originais na cloud

**Files:**
- Create: `src/cloud/cloud-files.ts`
- Test: `src/cloud/cloud-files.test.ts`

**Interfaces:**
- Consumes: Task 1; `repos.documents.{localOnlyIds, pendingUpload, remoteRecord, markUploaded, remoteOnly, storeDownloaded}`, `decryptBytes`.
- Produces: `cloudSyncFiles(repos, drive, key): Promise<{ uploaded: number; downloaded: number; quotaFull: boolean }>`: para cada original só local, grava `originais/<id>.bin` (bytes = `fromBase64(encBytes.data)`), e só depois devolve o registo `documents` (`remoteRecord(upload, 1)`) para ir no próximo ficheiro de alterações (via `pendingPush` com a tabela `documents`) e `markUploaded`; descarrega os `remoteOnly`, verifica que decifram e `storeDownloaded`. `quota_full` para os envios e devolve `quotaFull: true`. Sem janela de 12 meses.
  - Ruling a registar se `pendingPush` não aceitar `documents`: acrescentar o registo à lista de saída do protocolo por um parâmetro `extra: OutgoingRecord[]` de `cloudSync`.

- [ ] **Step 1: Testes:** um original em A chega a B com os mesmos bytes (depois de `cloudSync` A, `cloudSyncFiles` A, `cloudSync` A, `cloudSync` B, `cloudSyncFiles` B); um `.bin` adulterado não é guardado em B; `failNext('quota_full')` → `quotaFull: true` e o original continua só local.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/cloud/cloud-files.test.ts`)
- [ ] **Step 5:** Commit `feat(cloud): original files in the cloud folder`

### Task 5: Adaptador Microsoft Graph

**Files:**
- Create: `src/cloud/onedrive.ts`
- Test: `src/cloud/onedrive.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `class OneDrive implements CloudDrive`, `constructor(getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch)`.
  - `read`: `GET https://graph.microsoft.com/v1.0/me/drive/special/approot:/<path>:/content` (404 → `null`); segue o redirecionamento para o descarregamento.
  - `write`: até 4 MB, `PUT …:/<path>:/content` com `If-Match`/`If-None-Match`; acima, `POST …:/<path>:/createUploadSession` e envio em pedaços de 3 276 800 bytes (múltiplo de 320 KiB) para o `uploadUrl` (sem `Authorization`).
  - `list`: `GET …:/<folder>:/children?$select=name,size,eTag,file` com paginação por `@odata.nextLink`; 404 → `[]`; só ficheiros.
  - `remove`: `DELETE …:/<path>:`; 404 ignorado.
  - `account`: `GET /me/drive?$select=owner` → `owner.user.displayName`.
  - Erros: 401 → `needs_reconnect`; 412 → `conflict`; 429/503 → `throttled` com `retryAfterSeconds` do `Retry-After`, e uma nova tentativa automática se for ≤ 30 s; 507 ou `quotaLimitReached` → `quota_full`; `TypeError` do fetch → `offline`; resto → `unexpected`.
  - Caminhos com cada segmento em `encodeURIComponent`.

- [ ] **Step 1: Testes** com `fetch` falso que regista pedidos: URL e método de cada operação; `Authorization: Bearer <token>`; 5 MB vão por sessão de envio em 2 pedaços com `Content-Range` certos; `429` com `Retry-After: 1` repete uma vez e passa; `401` → `needs_reconnect`; `507` → `quota_full`; `list` junta duas páginas; `read` 404 → `null`; nome com espaço e acento codificado.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/cloud/onedrive.test.ts`)
- [ ] **Step 5:** Commit `feat(cloud): Microsoft Graph adapter for the app folder`

### Task 6: Autenticação Microsoft e cabeçalhos

**Files:**
- Create: `src/cloud/onedrive-auth.ts`, `public/auth-redirect.html`
- Modify: `package.json` (`@azure/msal-browser` com versão exata, conhecida e com mais de duas semanas), `security-headers.ts` (+ teste existente ou novo `security-headers.test.ts`), `src/vite-env.d.ts` (`VITE_ONEDRIVE_CLIENT_ID?`), `.env.example` se existir
- Test: `security-headers.test.ts`

**Interfaces:**
- Produces:
  - `oneDriveAvailable(): boolean` (há `VITE_ONEDRIVE_CLIENT_ID`)
  - `signInToOneDrive(returnTo: string): Promise<void>` (redireciona; guarda `returnTo` em `sessionStorage`)
  - `completeOneDriveSignIn(): Promise<{ returnTo: string } | null>` (chamado no arranque; `handleRedirectPromise`)
  - `oneDriveToken(): Promise<string>`: `acquireTokenSilent`; `InteractionRequiredAuthError` ou erro de renovação → `CloudError('needs_reconnect')`
  - `signOutOfOneDrive(): Promise<void>` (só limpa a cache local da MSAL)
  - Configuração: `cacheLocation: 'localStorage'`, `redirectUri: <origin>/auth-redirect.html` para o iframe silencioso (página em branco) e `navigateToLoginRequestUrl: false`; scopes `['Files.ReadWrite.AppFolder', 'offline_access']`; `iframeHashTimeout` 6000.
- Cabeçalhos: `connect-src` + `https://login.microsoftonline.com https://graph.microsoft.com` + os anfitriões de descarregamento do OneDrive pessoal (confirmar num teste real; ponto de partida `https://*.files.1drv.com https://*.livefilestore.com https://my.microsoftpersonalcontent.com`); `frame-src https://login.microsoftonline.com`; `/auth-redirect.html` com `frame-ancestors 'self'` e sem `X-Frame-Options: DENY` (bloco próprio no `_headers`). Ruling a registar: redirecionamento em vez de popup, porque `Cross-Origin-Opener-Policy: same-origin` corta a ligação ao popup.

- [ ] **Step 1: Testes** (só os cabeçalhos; a MSAL não é testada em unidade): `contentSecurityPolicy()` contém os novos anfitriões em `connect-src` e `frame-src https://login.microsoftonline.com`; `headersFile()` tem um bloco `/auth-redirect.html` com `frame-ancestors 'self'` e o bloco geral mantém `frame-ancestors 'none'`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run security-headers.test.ts`)
- [ ] **Step 5:** `pnpm build` → passa; `dist/_headers` com os dois blocos. Commit `feat(cloud): Microsoft sign-in (redirect) and security headers for OneDrive`

### Task 7: Correr a sincronização pela cloud na app

**Files:**
- Create: `src/cloud/cloud-run.ts`
- Modify: `src/features/sync/sync-store.ts` (escolhe servidor ou cloud), `src/features/auth/accounts.ts` (`changePassword` chama `rewrapCloudAccount` quando há `cloud`), `src/main.tsx` ou o arranque do router (`completeOneDriveSignIn`)
- Test: `src/cloud/cloud-run.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `driveFor(profile: Profile): CloudDrive` (OneDrive com `oneDriveToken`; nos testes injeta-se)
  - `runCloudSync({ profile, masterKey, repos, drive }): Promise<{ profile: Profile; pushed: number; received: number; conflicts: number; files?: { uploaded: number; downloaded: number; quotaFull: boolean } }>`: `cloudSync` + `cloudSyncFiles` se `files`; grava `cloud` atualizado e `lastSyncAt`.
  - `SyncStatus.error` passa a aceitar `CloudErrorCode`; `syncSession` usa `runCloudSync` quando `profile.cloud` e `runSync` quando `profile.sync`; `useAutoSync` corre com qualquer dos dois.

- [ ] **Step 1: Testes:** com `MemoryDrive`, `runCloudSync` grava o estado novo no `profilesDb`; com `failNext('needs_reconnect')` lança `CloudError('needs_reconnect')`, o perfil fica igual e as alterações continuam por enviar (na chamada seguinte, sem falha, chegam a outro dispositivo); `changePassword` num perfil com `cloud` regrava `conta.json`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/cloud/cloud-run.test.ts src/features/auth`)
- [ ] **Step 5:** Commit `feat(cloud): run sync through the user's cloud`

### Task 8: Cópia automática para o OneDrive

**Files:**
- Modify: `src/features/backup/auto-backup-run.ts`, `src/features/backup/auto-backup-store.ts`, `src/db/profiles.ts` (`AutoBackupConfig.target: 'folder' | 'cloud'`, `dir` opcional quando `cloud`)
- Create: `src/features/backup/backup-target.ts`
- Test: `src/features/backup/auto-backup-run.test.ts` (os casos atuais passam pela pasta) + novos casos

**Interfaces:**
- Produces:
  - `interface BackupTarget { list(): Promise<string[]>; write(name: string, bytes: Uint8Array): Promise<void>; remove(name: string): Promise<void>; ready(interactive: boolean): Promise<boolean | null> }`
  - `folderTarget(dir: FileSystemDirectoryHandle): BackupTarget` (o comportamento atual: permissão, `.tmp` + `move()`)
  - `cloudTarget(drive: CloudDrive): BackupTarget` (`copias/`; `ready` → `true`; `needs_reconnect` → outcome `needs_permission`)
  - `runAutoBackup` recebe `target: BackupTarget` em vez de ler `config.dir`; nomes, cifra, limpeza e calendário iguais. `tempFilesOf` só se aplica à pasta.
  - Configuração antiga sem `target` lê-se como `'folder'`.

- [ ] **Step 1: Testes:** todos os casos atuais verdes com `folderTarget(FakeFolder)`; com `cloudTarget(MemoryDrive)`: escreve `copias/faturometro-auto-<tag>-…-cifrado.zip`, apaga as antigas além de `keep` só desse perfil; `needs_reconnect` → `{ kind: 'needs_permission' }` sem escrever.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/features/backup`)
- [ ] **Step 5:** Commit `feat(backup): automatic backups to the cloud folder`

### Task 9: Servidor: mudança para a cloud e apagar só os dados

**Files:**
- Create: `server/migrations/0006_moved.sql` (`ALTER TABLE users ADD COLUMN moved_to TEXT`)
- Modify: `server/src/app.ts`, `src/sync/api.ts` (`movedTo` no pull; `moved(token, ownerProof, deleteData)`)
- Test: `server/src/app.test.ts`, `src/sync/sync.test.ts` ou o teste da API

**Interfaces:**
- Produces:
  - `POST /v1/moved` com `{ to: 'cloud', deleteData: boolean }`, com `X-Owner-Proof` (como `DELETE /v1/account`): grava `moved_to = 'cloud'`; se `deleteData`, apaga `records` e `chunks` do utilizador e mantém a conta e as sessões.
  - `GET /v1/changes` devolve `movedTo: 'cloud'` quando a coluna está preenchida.
  - Cliente: `SyncApi.moved(token, ownerProof, deleteData)`; `PullPage.movedTo?: 'cloud'`; `runSync` com `movedTo` lança `SyncError('moved_to_cloud')`.

- [ ] **Step 1: Testes do servidor:** sem prova de dono → 403; com `deleteData: true` → o pull seguinte não traz registos, traz `movedTo: 'cloud'`, e `/v1/admin/stats` de um administrador continua a responder; com `deleteData: false` os registos continuam. Cliente: `runSync` com `movedTo` → `SyncError('moved_to_cloud')`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run server src/sync`)
- [ ] **Step 5:** Commit `feat(server): mark an account as moved to the user's cloud, optionally deleting its data`

### Task 10: Ligação de administrador e migração

**Files:**
- Create: `src/sync/admin-link.ts`, `src/cloud/migrate.ts`
- Modify: `src/app/AppShell.tsx`, `src/features/alerts/HomePage.tsx`, `src/features/settings/AdminStatsSection.tsx`, `src/features/settings/SettingsPage.tsx` (`accountCopy.admin`) para usar `isAdmin(profile)` e `adminContributions(profile)`
- Test: `src/sync/admin-link.test.ts`, `src/cloud/migrate.test.ts`

**Interfaces:**
- Produces:
  - `isAdmin(profile): boolean` (`sync?.admin` ou `adminLink`), `adminContributions(profile): number`
  - `linkAdmin({ profile, masterKey, email, password, serverUrl, api? }): Promise<Profile>` (prelogin + `deriveSyncKeys` + login + `adminStats`; 403 → `SyncError('not_admin')`)
  - `refreshAdminLink({ profile, masterKey, api? }): Promise<Profile>` (chamado com a sincronização; atualiza `contributions`, `checkedAt`)
  - `migrateToCloud({ profile, masterKey, repos, drive, password, api? }): Promise<Profile>`: `enableCloudSync` → `runCloudSync` completo (com originais, se `sync.files`) → só se tudo correu bem: se `sync.admin`, grava `adminLink = { serverUrl: sync.serverUrl, token: sync.token, contributions: sync.contributions }` (reaproveita o token do servidor, já cifrado, sem pedir de novo a palavra-passe); remove `sync` e grava.
  - `finishServerData({ profile, masterKey, deleteData, api? })`: `POST /v1/moved` com `deleteData`; para quem não é administrador e `deleteData`, apaga a conta como hoje (`disableSync` com `deleteRemote`).

- [ ] **Step 1: Testes:** `linkAdmin` com API falsa grava `adminLink` com o token cifrado e `isAdmin` passa a `true`; não administrador → `not_admin`; `migrateToCloud` com `MemoryDrive`: depois dele o perfil tem `cloud` e não tem `sync`, e um segundo dispositivo por `connectFromCloud` tem os mesmos registos; uma falha no `runCloudSync` deixa o perfil com `sync` e sem `cloud` (nada se perde); administrador migrado fica com `adminLink`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/sync/admin-link.test.ts src/cloud/migrate.test.ts`)
- [ ] **Step 5:** Commit `feat(cloud): administrator link and migration from the sync server`

### Task 11: Interface

**Files:**
- Modify: `src/features/settings/SettingsPage.tsx` (`SyncSection`: escolha OneDrive/servidor, painel OneDrive, "Mudar para o meu OneDrive", ligação de administrador), `src/features/sync/ConnectPage.tsx` ("Entrar com o OneDrive"), `src/features/auth/LoginPage.tsx` (ligação para essa entrada), `src/features/backup/AutoBackupSection.tsx` (destino Pasta/OneDrive), `src/app/AppShell.tsx` (aviso "Ligar de novo ao OneDrive" quando `needs_reconnect`; aviso `moved_to_cloud` nos outros dispositivos), `src/i18n/pt-PT.ts`
- Test: os testes de domínio já cobrem a lógica; aqui `pnpm typecheck && pnpm lint && pnpm test`

- [ ] **Step 1:** `SyncSection` conforme o esboço do desenho: sem `oneDriveAvailable()` mostra só o servidor, como hoje. "Ligar" ao OneDrive pede a palavra-passe da conta (para verificar e para a ativação), chama `signInToOneDrive('/app/definicoes#sincronizacao')` e, no regresso, `enableCloudSync`.
- [ ] **Step 2:** Painel ligado: conta Microsoft (`accountLabel`), última sincronização, "Sincronizar agora", originais sim/não, "Desligar" (remove `cloud` do perfil; os dados no OneDrive ficam, com o texto a dizê-lo).
- [ ] **Step 3:** Com o servidor ligado: "Mudar para o meu OneDrive" → `migrateToCloud` → no fim, a escolha "Apagar os dados do servidor agora" / "Manter no servidor por agora" → `finishServerData`. Administrador: texto a explicar que a ligação de administrador continua.
- [ ] **Step 4:** Ligação de administrador nas definições, só quando o perfil não sincroniza pelo servidor e ainda não tem `adminLink` (formulário email/palavra-passe → `linkAdmin`).
- [ ] **Step 5:** `ConnectPage`: "Entrar com o OneDrive" → `signInToOneDrive('/entrar-sincronizado?cloud=onedrive')` → no regresso, palavra-passe → `connectFromCloud` → entrar.
- [ ] **Step 6:** Aviso "Ligar de novo ao OneDrive" (barra como a do `BackupBanner`, botão `action-secondary action-compact`) quando o estado da sincronização ou da cópia é `needs_reconnect`; e "Esta conta passou a sincronizar pelo OneDrive. Liga o OneDrive neste dispositivo." quando `moved_to_cloud`.
- [ ] **Step 7:** `AutoBackupSection`: com `cloud` ligado, escolha "OneDrive" (recomendado, funciona em qualquer browser) ou "Pasta neste computador".
- [ ] **Step 8:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → sem erros. Commit `feat(cloud): OneDrive in sync settings, sign-in, migration and notices`

### Task 12: Documentação

**Files:**
- Modify: `CLAUDE.md` (regra 1: ligações à Microsoft só com o OneDrive ligado; stack: `@azure/msal-browser`), `planning/PLAN.md` (fase nova com as caixas e decisão na secção 16), `src/i18n/pt-PT.ts` (página de privacidade: secção OneDrive, cache da MSAL no browser, o que fica na pasta), `docs/onedrive.md` (registo no Microsoft Entra passo a passo: conta pessoal, "Aplicativo de página única", URIs de redirecionamento de produção e `http://localhost:5173/auth-redirect.html`, permissão `Files.ReadWrite.AppFolder`, onde pôr o id em `VITE_ONEDRIVE_CLIENT_ID` localmente e na CI)
- [ ] **Step 1:** Atualizar.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → sem erros.
- [ ] **Step 3:** Commit `docs: OneDrive sync and backups`
