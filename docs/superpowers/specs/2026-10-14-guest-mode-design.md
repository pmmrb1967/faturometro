# Usar a app sem conta

Data: 2026-10-14 · Estado: aprovado em conversa, à espera de revisão escrita

## Objetivo

Quem chega à app pode usá-la logo, sem email nem palavra-passe. Fica sem sincronização entre dispositivos e sem IA, e os dados não ficam protegidos por palavra-passe. A qualquer momento pode criar uma conta e fica com tudo o que já tinha, sem nova cifra das faturas.

## O que já existe

- `src/features/auth/accounts.ts`: `createAccount` cria um `Profile` (`src/db/profiles.ts`) com `email` (índice único `&email`) e `wrappedKey` (a chave mestra embrulhada pela palavra-passe e pela chave de recuperação, `src/lib/crypto.ts`). Os dados de cada perfil vivem numa base própria (`ProfileDb(profile.id)`), cifrados com a chave mestra.
- `src/features/auth/session.tsx`: a chave mestra só existe em memória; recarregar a página ou 15 minutos sem atividade bloqueiam a app.
- `src/features/auth/RequireSession.tsx`: sem sessão, `/app` manda para `/entrar`.
- A chave da API da Anthropic está nas definições (`settings.aiApiKey`), cifrada como o resto. A cópia de segurança já a retira (`src/features/backup/backup.ts`).
- "Apagar tudo" (Definições → Os teus dados) apaga o perfil e os dados.

## Decisões

| Decisão | Porquê |
|---|---|
| Sem conta = perfil com a chave mestra guardada sem embrulho no browser | Permite usar a mesma base cifrada e passar a conta sem nova cifra |
| Um só perfil sem conta por browser | Simples; quem quer vários perfis cria contas |
| Sem conta não há IA (nem guardar a chave da API) | Uma chave que gasta dinheiro não fica exposta num computador partilhado; a app funciona sem IA (regra 4) |
| Sem conta não há sincronização | O servidor precisa de email e de uma palavra-passe que proteja a chave |
| "Começar sem conta" é o botão principal da página inicial; "Criar conta" fica ao lado como secundário | O objetivo é tirar o atrito da primeira utilização |
| Sem conta não há bloqueio automático nem "Bloquear" | Não há nada para desbloquear |
| Criar conta a partir do modo sem conta embrulha a chave existente | Uma só escrita no perfil; nada se perde |

## Desenho

### 1. Perfil sem conta

- `Profile` passa a aceitar um perfil sem conta: `email: ''`, sem `wrappedKey`, com `guestKey: CryptoKey` (a chave mestra, extraível, guardada diretamente no IndexedDB por clonagem estruturada). O tipo fica explícito (por exemplo, `wrappedKey` e `guestKey` opcionais com um teste de tipo `isGuest(profile)`); o plano fixa a forma exata.
- O índice único `&email` garante, sem código extra, que só há um perfil com `email: ''`. A versão do esquema de `faturometro-profiles` não muda (os índices são os mesmos).
- `accounts.ts` ganha:
  - `createGuest()`: gera a chave mestra (mesmos parâmetros de `createAccountKeys`), grava o perfil e devolve `UnlockedAccount`. Se já existir um perfil sem conta, devolve esse.
  - `openGuest()`: devolve o perfil sem conta e a sua chave, ou `null`.
  - `convertGuest(account, email, password)`: cria o embrulho pela palavra-passe e pela chave de recuperação da chave existente, grava o perfil com `email` e `wrappedKey` e sem `guestKey` (um só `put`), devolve o perfil e a chave de recuperação. Email já usado neste browser → `AccountError('email_taken')`.
- `listAccountEmails`, `unlockAccount` e afins ignoram o perfil sem conta (não tem email).
- `crypto.ts` ganha a função que embrulha uma chave mestra existente (palavra-passe + recuperação), partilhada com `createAccountKeys`.

### 2. Entrar na app

- Página inicial (`Landing.tsx`): botão principal "Começar sem conta" (ou "Continuar sem conta" se o perfil já existir) que abre a sessão sem conta e vai para `/app`; "Criar conta" passa a botão secundário; "Entrar" no topo mantém-se.
- `/app` sem sessão: se existir perfil sem conta **e** não houver contas com palavra-passe neste browser, abre-o logo; caso contrário vai para `/entrar`. A regra fica numa função pura testável.
- `/entrar` mostra "Continuar sem conta" quando existe perfil sem conta.
- Sessão sem conta: sem bloqueio automático e sem o botão "Bloquear". Conta como sessão aberta para a política de atualização da PWA (como hoje).

### 3. Limites sem conta

- **Cabeçalho**: em vez do email, "Sem conta" e o botão "Criar conta", sempre visíveis.
- **Definições**:
  - cartão curto: os dados não estão protegidos por palavra-passe; quem usa este browser vê-os; limpar os dados do browser apaga tudo; faz uma cópia de segurança; botão "Criar conta";
  - Sincronização: "Cria uma conta para sincronizar entre dispositivos" com "Criar conta", sem os controlos de ligar;
  - IA: "Cria uma conta para usar a IA", sem o campo da chave;
  - a secção da conta (email, mudar palavra-passe) não aparece;
  - "Apagar tudo" funciona e apaga o perfil sem conta.
- **IA**: sem conta, a app trata a IA como indisponível mesmo que exista `aiApiKey` nas definições (os pontos de entrada já mostram o caminho sem IA quando não há chave).

### 4. Criar conta a partir do modo sem conta

- "Criar conta" (cabeçalho e Definições) abre `/criar-conta` em modo de conversão quando a sessão é sem conta: mesmo formulário (email, palavra-passe, confirmação), texto a dizer que os dados atuais passam para a conta.
- Ao submeter: `convertGuest`, depois o passo habitual da chave de recuperação (`RecoveryKeyStep`), depois a sessão continua com o perfil atualizado (`updateProfile`), já com bloqueio automático, sincronização e IA disponíveis.
- Sem sessão sem conta, `/criar-conta` cria uma conta nova e vazia, como hoje.

### 5. Textos

- Todos os textos novos em `src/i18n/pt-PT.ts`.
- A página Privacidade explica o modo sem conta: os dados ficam só neste browser, cifrados com uma chave guardada no próprio browser, sem palavra-passe.
- `planning/PLAN.md`: decisão registada na secção 16.

## Erros

- Email já usado na conversão: mensagem de erro habitual no campo do email; o perfil sem conta fica como estava.
- Falha a gravar o perfil na conversão: o `put` é único, por isso o perfil fica sem conta ou já convertido, nunca meio-convertido.
- Browser sem IndexedDB ou em modo privado restrito: o mesmo comportamento de hoje ao criar conta.

## Testes

- `createGuest`: cria um perfil sem email com chave; uma segunda chamada devolve o mesmo perfil.
- `convertGuest`: os dados cifrados antes continuam legíveis com a chave aberta pela palavra-passe e pela chave de recuperação; o perfil já não tem `guestKey`; email repetido → `email_taken` e perfil intacto.
- `unlockAccount` e `listAccountEmails` ignoram o perfil sem conta.
- Regra de entrada em `/app`: sem perfis → `/entrar`; só sem conta → abre; sem conta + contas → `/entrar`.
- IA indisponível sem conta mesmo com `aiApiKey`.

## Fora de âmbito

- Vários perfis sem conta no mesmo browser.
- Converter um perfil sem conta numa conta sincronizada já existente noutro dispositivo (`/entrar-sincronizado` continua a criar a sua própria conta).
- Proteção dos dados sem conta (por exemplo, PIN): quem a quer cria conta.
