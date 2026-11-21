# Cópia de segurança automática para uma pasta

Aprovado no chat a 2026-11-21 (opção A: a cópia cifrada abre-se com a palavra-passe da conta ou com a chave de recuperação).

## Porquê

Hoje a cópia de segurança é só manual (Definições → Os teus dados → Exportar), com um aviso aos 30 dias (`src/domain/backup-reminder.ts`). O utilizador quer o que tinha no Spending Tracker: cópias feitas sozinhas, com periodicidade escolhida, guardadas num sítio seu (por exemplo uma pasta do OneDrive, que as envia para a cloud). Assim não depende de se lembrar de exportar.

## Objetivos

- Escolher uma pasta uma vez; a app grava lá o ZIP da cópia com a periodicidade escolhida.
- **Cifrada por omissão**, com opção de a gravar em claro (como a exportação manual).
- Guardar só as últimas N cópias automáticas, apagando as mais antigas.
- Restaurar uma cópia cifrada noutro dispositivo ou noutra conta só com a palavra-passe da conta que a fez, ou com a chave de recuperação.

## Fora de âmbito

- Escrever diretamente na cloud (OneDrive/Drive/Dropbox por OAuth): é a fase seguinte, com alteração da regra 1.
- Cópias em segundo plano com a app fechada: uma app web não o faz de forma fiável.
- Mudar a exportação manual: continua em claro e igual.
- Firefox, Safari e telemóveis: sem escolha de pasta no browser; ficam com o aviso dos 30 dias.

## Anti-objetivos

- Falhar em silêncio: se a cópia não foi feita, o utilizador tem de o ver.
- Apagar ficheiros que não sejam cópias automáticas da app.
- Uma cópia cifrada que só abre no browser que a fez (com a chave mestra solta, sem a palavra-passe).

## Abordagens

1. **Pasta escolhida pelo utilizador (File System Access API, `showDirectoryPicker`)**: escolhida. Grava e apaga ficheiros na pasta sem perguntar de cada vez; com uma pasta do OneDrive, a cloud fica com a cópia sem nova ligação externa (a regra 1 não muda). Só Chrome e Edge de computador.
2. Descarregamento automático para Transferências: o browser pode bloquear ou perguntar, não se apagam as antigas e enche a pasta. Rejeitada.
3. Guardar dentro do browser (OPFS): perde-se com os dados do browser, que é exatamente o que a cópia protege. Rejeitada.

## Desenho

### Definições (por dispositivo)

Cada dispositivo tem a sua pasta, por isso a configuração não sincroniza. Fica no perfil local (`profilesDb`), numa tabela nova `autoBackups` (chave: id do perfil), com uma nova versão do esquema, migração e teste:

- `dir`: o `FileSystemDirectoryHandle` (o IndexedDB guarda-o tal como está).
- `every`: `'day' | 'week' | 'month'` (por omissão `'week'`).
- `keep`: 3, 5 ou 10 (por omissão 5).
- `encrypted`: `true` por omissão; num perfil convidado (sem palavra-passe) é sempre `false`, com aviso.
- `lastRunAt`, `lastError?`: estado da última tentativa.

Ao gravar uma cópia, atualiza também `settings.lastBackupAt` (sincronizado), para o aviso dos 30 dias contar com ela em todos os dispositivos.

### Quando corre

Lógica pura em `src/domain/auto-backup.ts` (sem React): `isDue(lastRunAt, every, now)` e `filesToPrune(names, keep)`.

- Ao abrir a conta e de hora a hora com a app aberta: se estiver na hora, grava.
- Permissão da pasta: `queryPermission({ mode: 'readwrite' })`. Se for `granted`, grava sozinha. Se for `prompt` (o Chrome volta a pedir após fechar o browser, salvo se o utilizador escolheu "Permitir sempre"), não pode pedir sem um clique: mostra no Início o aviso "Cópia automática por fazer" com o botão **Fazer cópia agora**, que pede a permissão e grava.
- Erro (pasta apagada, disco cheio, permissão recusada): guarda `lastError`, mostra-o nas definições e no aviso do Início, e não volta a tentar na mesma sessão até um clique.

### Ficheiros

- Nome: `faturometro-auto-AAAA-MM-DD-HHmm.zip` (em claro) ou `faturometro-auto-AAAA-MM-DD-HHmm-cifrado.zip`.
- Limpeza: depois de gravar, apaga as mais antigas para além de `keep`, **só** entre os ficheiros com esse padrão de nome.
- Grava primeiro com um nome temporário e muda o nome no fim (ou usa `createWritable`, que só substitui no `close()`), para uma falha não deixar uma cópia meio escrita com nome válido.

### Formato cifrado

Um ZIP com dois ficheiros:

- `faturometro-cifrado.json`: `{ format: 'faturometro-encrypted-backup', version: 1, exportedAt, key: WrappedMasterKey, iv }`. `key` é a chave mestra da conta tal como está guardada no perfil (`byPassword` + `kdf`, `byRecoveryKey` + `recoverySalt`).
- `dados.bin`: o ZIP normal da cópia (`exportBackup`), cifrado com AES-GCM pela chave mestra.

Quem tem o ficheiro vê só a data da exportação. Abrir exige a palavra-passe ou a chave de recuperação (PBKDF2 com 600 000 iterações, o mesmo nível dos dados guardados no browser). Depois de mudar a palavra-passe, as cópias antigas abrem com a palavra-passe antiga ou com a chave de recuperação; o texto das definições diz isso.

### Restaurar

O botão "Importar cópia de segurança" aceita os dois formatos. Se o ficheiro for cifrado, pede a palavra-passe (ou a chave de recuperação), desembrulha a chave mestra da cópia (que pode ser de outra conta), decifra `dados.bin` e segue pelo `importBackup` atual (junta, só substitui o que for mais recente). Palavra-passe errada → mensagem própria, sem perder o que se escreveu.

### Interface (Definições → Os teus dados)

Novo bloco "Cópia automática":

```
Cópia automática                                   [ Ligada ]
Pasta: OneDrive/Faturometro                   [Mudar pasta]
Periodicidade: (•) Semanal ( ) Diária ( ) Mensal
Guardar as últimas: [5 ▾] cópias
[x] Cifrar com a palavra-passe da conta (recomendado)
Última cópia: 21/11/2026, 12:30
```

- Sem suporte no browser: o bloco explica que a cópia automática precisa do Chrome ou do Edge de computador e mantém a exportação manual.
- Ao desligar "Cifrar": aviso de que a cópia fica legível por quem tiver acesso à pasta (e à cloud, se for uma pasta sincronizada).
- Textos em `src/i18n/pt-PT.ts`; botões só com as classes de `src/components/buttons.css`.

### Testes

- `src/domain/auto-backup.test.ts`: `isDue` (limites de dia, semana e mês) e `filesToPrune` (ignora outros nomes, mantém `keep`).
- Cifra: ida e volta com palavra-passe e com chave de recuperação; palavra-passe errada; cópia de outra conta importada para a conta aberta.
- Migração do `profilesDb` para a nova versão.
- Gravação com um `FileSystemDirectoryHandle` falso (gravar, apagar as antigas, erro de escrita).

### Documentação

- `planning/PLAN.md`: caixa nova e decisão na secção 16.
- Página de privacidade: a cópia automática vai só para a pasta escolhida; cifrada por omissão.

## Deixado a quem implementa

- Onde corre o temporizador (provavelmente ao lado do da sincronização automática).
- O texto exato das mensagens e do aviso no Início.
- Se o nome da pasta mostrado é só `dir.name` (o browser não dá o caminho completo).
