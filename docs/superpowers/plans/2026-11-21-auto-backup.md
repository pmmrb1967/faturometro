# Cópia automática para uma pasta: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A app grava sozinha, com a periodicidade escolhida, a cópia de segurança (cifrada por omissão) numa pasta escolhida pelo utilizador, e importa essas cópias.

**Architecture:** Lógica pura de calendário e nomes em `src/domain/auto-backup.ts`; formato cifrado em `src/features/backup/encrypted-backup.ts` (ZIP com cabeçalho + `exportBackup` cifrado pela chave mestra); configuração por dispositivo numa tabela nova do `profilesDb`; um executor que escreve num `FileSystemDirectoryHandle`, chamado por um hook em `AppShell` (como `useAutoSync`) e pelo botão "Fazer cópia agora".

**Tech Stack:** React 18, TypeScript strict, Dexie, fflate, WebCrypto, File System Access API, Vitest + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-21-auto-backup-design.md`

## Global Constraints

- Código e comentários em inglês; texto visível em português europeu (tratamento por "tu") só em `src/i18n/pt-PT.ts`.
- Sem `any`. Botões só com `action-primary`, `action-secondary`, `danger`, `action-wide`, `action-compact`; cores só pelos tokens de `:root`.
- Esquema Dexie: nova versão + migração + teste; nunca alterar `version(1)` do `profilesDb`.
- Nenhuma ligação externa nova (regra 1 inalterada).
- Por omissão: `every: 'week'`, `keep: 5`, `encrypted: true`. Opções: `'day' | 'week' | 'month'`; `keep` 3, 5 ou 10.
- Nomes: `faturometro-auto-AAAA-MM-DD-HHmm.zip` e `faturometro-auto-AAAA-MM-DD-HHmm-cifrado.zip`. Só ficheiros com este padrão podem ser apagados.
- Cabeçalho cifrado: `format: 'faturometro-encrypted-backup'`, `version: 1`.
- Antes de cada commit: `pnpm typecheck && pnpm lint && pnpm test` sem erros. Commits Conventional Commits, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não fazer push sem perguntar (push = produção).

## Review Focus

1. Escrita interrompida (o browser fecha a meio): nunca deve ficar um ficheiro com nome de cópia válida mas truncado. Teste na Tarefa 4: `close()` que falha → nenhum ficheiro novo com o padrão, `lastError` gravado.
2. A pasta tem outros ficheiros, incluindo cópias manuais `faturometro-2026-11-21.zip`: a limpeza não lhes toca. Teste na Tarefa 1 (`filesToPrune`) e na Tarefa 4.
3. Importar uma cópia cifrada de **outra** conta para a conta aberta (computador novo): tem de funcionar com a palavra-passe da conta de origem. Teste na Tarefa 2.
4. Relógio: a app abre várias vezes no mesmo dia com `every: 'day'`, ou mudou o mês com `every: 'month'` a dia 31. Teste na Tarefa 1 (`isDue` com 2026-01-31 → 2026-02-28).
5. Perfil convidado: sem chave embrulhada, a cópia nunca pode ser tentada cifrada (rebentava em `wrappedKeyOf`). Teste na Tarefa 4: convidado com `encrypted: true` gravado por engano → grava em claro.

---

### Task 1: Calendário e nomes das cópias

**Files:**
- Create: `src/domain/auto-backup.ts`
- Test: `src/domain/auto-backup.test.ts`

**Interfaces:**
- Produces:
  - `type AutoBackupEvery = 'day' | 'week' | 'month'`
  - `const AUTO_BACKUP_KEEP = [3, 5, 10] as const`
  - `isDue(lastRunAt: string | undefined, every: AutoBackupEvery, now: Date): boolean`: sem `lastRunAt` → `true`; `'day'` → dia de calendário local diferente; `'week'` → ≥ 7 dias de calendário; `'month'` → mesmo dia do mês seguinte, ou o último dia se esse não existir.
  - `autoBackupFileName(now: Date, encrypted: boolean): string`, em hora local.
  - `isAutoBackupFileName(name: string): boolean`
  - `filesToPrune(names: readonly string[], keep: number): string[]`: só nomes que passam `isAutoBackupFileName`, ordenados pela data do nome; devolve os mais antigos além de `keep`.

- [ ] **Step 1: Write the failing tests**
  - `isDue(undefined, 'week', d('2026-11-21T10:00'))` → `true`
  - `isDue('2026-11-21T08:00', 'day', d('2026-11-21T23:00'))` → `false`; `d('2026-11-22T00:05')` → `true`
  - `isDue('2026-11-14T20:00', 'week', d('2026-11-21T09:00'))` → `true`; `d('2026-11-20T23:59')` → `false`
  - `isDue('2026-01-31T10:00', 'month', d('2026-02-27T10:00'))` → `false`; `d('2026-02-28T00:01')` → `true`
  - `autoBackupFileName(d('2026-11-21T12:30'), true)` → `'faturometro-auto-2026-11-21-1230-cifrado.zip'`; com `false` → `'faturometro-auto-2026-11-21-1230.zip'`
  - `filesToPrune([...6 auto (cifrados e em claro misturados), 'faturometro-2026-11-21.zip', 'notas.txt'], 5)` → só a auto mais antiga
  - `filesToPrune(['faturometro-auto-2026-11-21-1230.zip'], 5)` → `[]`
- [ ] **Step 2:** `pnpm vitest run src/domain/auto-backup.test.ts` → FAIL (module not found)
- [ ] **Step 3:** Implementar as funções acima (sem React nem Dexie).
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(backup): schedule and file names of automatic backups`

### Task 2: Formato cifrado e importação de cópias cifradas

**Files:**
- Create: `src/features/backup/encrypted-backup.ts`
- Modify: `src/features/backup/backup.ts` (`BackupError.code` ganha `'wrong_secret'`)
- Test: `src/features/backup/encrypted-backup.test.ts`

**Interfaces:**
- Consumes: `exportBackup`/`importBackup` (existentes); `encryptBytes`, `decryptBytes`, `unlockWithPassword`, `unlockWithRecoveryKey`, `WrappedMasterKey`, `WrongSecretError` de `src/lib/crypto.ts`.
- Produces:
  - `encryptBackup(zip: Uint8Array, masterKey: CryptoKey, wrapped: WrappedMasterKey): Promise<Uint8Array>`: ZIP com `faturometro-cifrado.json` (`{ format, version, exportedAt, key, iv }`) e `dados.bin` (o texto cifrado, em binário, guardado sem compressão).
  - `isEncryptedBackup(bytes: Uint8Array): boolean`: só lê o ZIP e procura `faturometro-cifrado.json`; não rebenta com ficheiros que não sejam ZIP.
  - `decryptBackup(bytes: Uint8Array, secret: { password: string } | { recoveryKey: string }): Promise<Uint8Array>`: devolve o ZIP normal; segredo errado → `BackupError('wrong_secret')`; cabeçalho inválido (zod) → `BackupError('not_a_backup')`.

- [ ] **Step 1: Write the failing tests** (usar `createAccountKeys(password, 1000)` para ser rápido, e fake-indexeddb como os testes de `backup.test.ts`)
  - ida e volta: `decryptBackup(await encryptBackup(zip, key, wrapped), { password })` devolve bytes iguais a `zip`
  - o mesmo com `{ recoveryKey }`
  - palavra-passe errada → rejeita com `BackupError` de código `'wrong_secret'`
  - `isEncryptedBackup` → `true` para o cifrado, `false` para um `exportBackup` normal e para `new Uint8Array([1, 2, 3])`
  - o texto do ficheiro cifrado não contém o nome de um fornecedor que estava nos dados (os dados não ficam em claro)
  - **outra conta:** dados exportados e cifrados pela conta A, importados (`decryptBackup` com a palavra-passe de A + `importBackup`) para os repositórios da conta B → os registos aparecem em B
- [ ] **Step 2:** `pnpm vitest run src/features/backup/encrypted-backup.test.ts` → FAIL
- [ ] **Step 3:** Implementar. Guardar `iv` em base64 no JSON e o texto cifrado em binário em `dados.bin` (via `fromBase64(encryptBytes(...).data)`), para não inflacionar 33 %.
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(backup): encrypted backup format, opened with the account password`

### Task 3: Configuração por dispositivo no profilesDb

**Files:**
- Modify: `src/db/profiles.ts`
- Test: `src/db/profiles-auto-backup.test.ts`

**Interfaces:**
- Produces:
  - `interface AutoBackupConfig { profileId: string; dir: FileSystemDirectoryHandle; dirName: string; every: AutoBackupEvery; keep: 3 | 5 | 10; encrypted: boolean; lastRunAt?: string; lastError?: AutoBackupErrorCode }`
  - `type AutoBackupErrorCode = 'permission_denied' | 'write_failed' | 'folder_missing'`
  - `ProfilesDb.autoBackups: Table<AutoBackupConfig, string>`, com `this.version(2).stores({ profiles: 'id, &email', autoBackups: 'profileId' })`
  - `DEFAULT_AUTO_BACKUP = { every: 'week', keep: 5, encrypted: true } as const`
  - Apagar um perfil (`deleteEverything` em `BackupSection.tsx`) apaga também a sua linha em `autoBackups`.

- [ ] **Step 1: Write the failing test**: abrir uma `Dexie('faturometro-profiles-test')` só com `version(1)`, gravar um perfil, fechar; abrir como `ProfilesDb` com o mesmo nome (o construtor passa a aceitar o nome, por omissão `'faturometro-profiles'`) → o perfil continua lá e `autoBackups.count()` é `0`; gravar e ler uma configuração (com um objeto simples no lugar do handle).
- [ ] **Step 2:** `pnpm vitest run src/db/profiles-auto-backup.test.ts` → FAIL
- [ ] **Step 3:** Implementar a versão 2 e o tipo. `FileSystemPermissionMode`/`queryPermission`/`requestPermission`/`showDirectoryPicker` não estão no `lib.dom` do TypeScript: declará-los num ficheiro `src/features/backup/fs-access.ts` (tipos mínimos + `supportsFolderBackup(): boolean`, que verifica `'showDirectoryPicker' in window`).
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(db): per-device automatic backup settings (profiles v2)`

### Task 4: Executor da cópia automática

**Files:**
- Create: `src/features/backup/auto-backup-run.ts`
- Test: `src/features/backup/auto-backup-run.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isDue`, `autoBackupFileName`, `filesToPrune`), Task 2 (`encryptBackup`), Task 3 (`AutoBackupConfig`, `profilesDb.autoBackups`), `exportBackup`, `updateSettings(repos, { lastBackupAt })`, `isGuest`, `wrappedKeyOf`.
- Produces:
  - `type AutoBackupOutcome = { kind: 'written'; name: string } | { kind: 'not_due' } | { kind: 'needs_permission' } | { kind: 'error'; code: AutoBackupErrorCode }`
  - `runAutoBackup(input: { session: Pick<Session, 'profile' | 'repos' | 'masterKey'>; config: AutoBackupConfig; now: Date; force: boolean; interactive: boolean }): Promise<AutoBackupOutcome>`
    - `force` ignora `isDue` (botão "Fazer cópia agora").
    - Permissão: `queryPermission({ mode: 'readwrite' })`; se `'prompt'` e `interactive` → `requestPermission`; se continuar sem `'granted'` → `needs_permission` (não interativo) ou erro `permission_denied` (interativo).
    - Cifra só se `config.encrypted && !isGuest(profile)`.
    - Escreve com `getFileHandle(name, { create: true })` + `createWritable()` + `write` + `close()`; se falhar, `removeEntry(name)` (ignorando erros) e devolve `write_failed`. `NotFoundError` ao abrir a pasta → `folder_missing`.
    - Depois de escrever: apaga `filesToPrune(nomes da pasta, keep)`; grava `lastRunAt = now.toISOString()` e limpa `lastError`; `updateSettings(repos, { lastBackupAt: today })`.
    - Em erro: grava `lastError`, não mexe em `lastRunAt`.

- [ ] **Step 1: Write the failing tests** com um `FakeDirectory` (Map de nome → bytes; permissão configurável; `createWritable` que pode falhar no `close`):
  - não está na hora → `not_due`, pasta igual
  - escreve `…-cifrado.zip` cujo conteúdo `isEncryptedBackup` reconhece; `lastRunAt` gravado; `settings.lastBackupAt` igual à data de hoje
  - `encrypted: false` → nome sem `-cifrado` e `importBackup` aceita os bytes
  - convidado com `encrypted: true` → grava em claro, sem rebentar
  - 5 cópias auto + `faturometro-2026-11-01.zip` + `notas.txt`, `keep: 5` → depois de escrever ficam 5 auto (a mais antiga saiu) e os outros dois ficheiros intactos
  - permissão `'prompt'`, `interactive: false` → `needs_permission`, nada escrito
  - `close()` falha → `{ kind: 'error', code: 'write_failed' }`, nenhum ficheiro novo com o padrão, `lastError` gravado, `lastRunAt` inalterado
- [ ] **Step 2:** `pnpm vitest run src/features/backup/auto-backup-run.test.ts` → FAIL
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** Commit `feat(backup): write automatic backups to the chosen folder`

### Task 5: Hook, definições e aviso no Início

**Files:**
- Create: `src/features/backup/auto-backup-store.ts` (hook + estado partilhado), `src/features/backup/AutoBackupSection.tsx`
- Modify: `src/app/AppShell.tsx` (chamar `useAutoBackup(session)` ao lado de `useAutoSync`), `src/features/backup/BackupSection.tsx` (mostrar `<AutoBackupSection />` depois de "Exportar tudo"; importar ficheiros cifrados), `src/features/alerts/HomePage.tsx` (aviso), `src/features/backup/use-backup-status.ts` se for preciso, `src/i18n/pt-PT.ts`
- Test: `src/features/backup/auto-backup-store.test.ts`

**Interfaces:**
- Consumes: Task 3 e Task 4.
- Produces:
  - `useAutoBackup(session: Session | null): void`: ao abrir a conta e de 60 em 60 minutos, `runAutoBackup({ force: false, interactive: false })`; não volta a tentar na mesma sessão depois de um erro.
  - `useAutoBackupState(): { outcome?: AutoBackupOutcome; config?: AutoBackupConfig }` para o Início e as definições.
  - `backupNow(session): Promise<AutoBackupOutcome>`: `force: true, interactive: true` (só a partir de um clique).

- [ ] **Step 1: Write the failing test** do estado: com `runAutoBackup` simulado, `useAutoBackup` corre uma vez ao montar; um erro não provoca nova tentativa ao fim de 60 minutos (timers falsos do Vitest); `backupNow` corre mesmo depois do erro.
- [ ] **Step 2:** `pnpm vitest run src/features/backup/auto-backup-store.test.ts` → FAIL
- [ ] **Step 3:** Implementar o hook e o estado.
- [ ] **Step 4:** O mesmo comando → PASS
- [ ] **Step 5:** `AutoBackupSection` conforme o esboço do desenho: interruptor; "Escolher pasta"/"Mudar pasta" (`showDirectoryPicker({ mode: 'readwrite', id: 'faturometro-backup' })`, grava a configuração com `DEFAULT_AUTO_BACKUP` e faz logo uma cópia com `backupNow`); periodicidade; "Guardar as últimas"; "Cifrar com a palavra-passe da conta (recomendado)" (desativado e desligado para convidados, com o texto a explicar porquê); última cópia e último erro; "Fazer cópia agora". Sem `supportsFolderBackup()`, só o texto a explicar que é preciso Chrome ou Edge de computador. Ao desligar a cifra, aviso de que o ficheiro fica legível por quem tiver acesso à pasta ou à cloud. Texto sobre a mudança de palavra-passe: as cópias antigas abrem com a palavra-passe antiga ou com a chave de recuperação.
- [ ] **Step 6:** Importação em `BackupSection`: se `isEncryptedBackup(bytes)`, mostrar um campo de palavra-passe (com a alternativa "Usar a chave de recuperação") e um botão "Abrir cópia"; `decryptBackup` → `importBackup`; `wrong_secret` → `copy.errors.wrong_secret` sem limpar o ficheiro escolhido. `accept` continua `.zip`.
- [ ] **Step 7:** Início: com `outcome` `needs_permission` ou `error`, um `alert-warning` na lista (mesmo padrão do aviso de cópia em falta) com o botão "Fazer cópia agora" (`action-compact`), que chama `backupNow`. A cópia automática conta para o aviso dos 30 dias através de `lastBackupAt` (não precisa de alteração).
- [ ] **Step 8:** Verificar à mão com `pnpm dev` no Chrome: escolher pasta, ver a cópia aparecer, mudar a periodicidade, importar a cópia cifrada com a palavra-passe certa e com uma errada, recarregar o separador e ver o aviso de permissão no Início.
- [ ] **Step 9:** `pnpm typecheck && pnpm lint && pnpm test` → sem erros. Commit `feat(backup): automatic backup settings, import of encrypted backups and home notice`

### Task 6: Documentação

**Files:**
- Modify: `planning/PLAN.md` (caixa nova marcada na fase 6 e linha na secção 16 com a decisão de 2026-11-21: pasta pelo File System Access, cifrada com a chave da conta, por dispositivo, sem nova ligação externa), `src/landing/PrivacyPage.tsx` + o respetivo texto em `src/i18n/pt-PT.ts` (a cópia automática vai só para a pasta que escolheres; cifrada por omissão; se a pasta for de uma cloud, essa cloud recebe o ficheiro)

- [ ] **Step 1:** Atualizar os dois.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → sem erros.
- [ ] **Step 3:** Commit `docs: automatic backup to a folder`
