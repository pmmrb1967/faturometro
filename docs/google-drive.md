# Google Drive: registo da app

A sincronização pelo Google Drive precisa de um projeto na Google Cloud com um cliente OAuth. Faz-se **uma vez, pelo responsável**. Os utilizadores não fazem nada disto: só carregam em "Ligar ao Google Drive" e aceitam o pedido da Google.

Ao contrário do OneDrive e do Dropbox, há **um segredo**. A Google só dá acesso duradouro a quem tem o segredo do cliente, e por isso:

- o **Client ID** não é secreto e vai para a app (`PROJECT_GOOGLE_CLIENT_ID` em `src/cloud/cloud-config.ts`) e para o servidor;
- o **Client secret** vai **só para os secrets do Worker** (`wrangler secret put`), nunca para o repositório nem para a app;
- a troca do código e as renovações passam pelo servidor (`POST /v1/google/token`, `server/src/google-token.ts`). O servidor junta o segredo e envia o pedido à Google, sem guardar nem registar nada. É **um único segredo para todos os utilizadores**: a ligação de cada utilizador fica cifrada no browser dele, e o servidor não guarda nada por utilizador.

Sem o Client ID na app, a opção Google Drive não aparece. Sem os dois secrets no servidor, a rota responde 404 e a entrada falha.

**Registo atual:** ainda não feito.

## Passos (consola em inglês)

Os nomes dos menus mudam com frequência; se algum não bater certo, procura o equivalente.

1. Entra em <https://console.cloud.google.com> com a conta Google que vai gerir a app. Os utilizadores ligam a sua própria conta.
2. **Novo projeto**: no seletor de projetos do topo, **New project**, com o nome `Faturometro`. Não é preciso faturação.
3. **Ativar a API**: **APIs & Services → Library**, procura **Google Drive API** e carrega em **Enable**.
4. **Ecrã de consentimento** (**Google Auth Platform**, antes chamado *OAuth consent screen*):
   - **Branding**: nome da app `Faturómetro`, email de apoio e email de contacto do programador. A página inicial e a de privacidade (`https://app.faturometro.workers.dev/` e `…/privacidade`) também podem ser indicadas.
   - **Audience**: **External**.
   - **Data access → Add or remove scopes**: só `https://www.googleapis.com/auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app"). É uma permissão **não sensível**, o que evita a verificação de segurança da Google. Não acrescentes `drive` nem `drive.appdata`.
   - **Publishing status**: carrega em **Publish app** para passar a **In production**. Em *Testing*, só os utilizadores de teste listados conseguem entrar e **a ligação expira ao fim de 7 dias**. Se a Google pedir a verificação da marca (nome e logótipo), segue o pedido; com `drive.file` não há verificação da permissão.
5. **Cliente OAuth** (**Clients → Create client**):
   - **Application type**: **Web application**. Não escolher outro tipo: só este tem segredo e endereços de regresso.
   - **Name**: `Faturometro web`.
   - **Authorized redirect URIs**: `https://app.faturometro.workers.dev/nuvem-retorno` e `http://localhost:5173/nuvem-retorno`.
   - **Authorized JavaScript origins**: não é preciso (a troca do código é feita pelo servidor).
   - **Create**. Copia o **Client ID** e o **Client secret**. O segredo pode não voltar a aparecer por inteiro: se o perderes, cria um novo no mesmo cliente.
6. **Pôr o segredo no servidor** (uma vez; a conta do `wrangler` é a do Cloudflare):

   ```bash
   cd server
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID      # cola o Client ID
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET  # cola o Client secret
   ```

   Os secrets ficam ativos logo, sem novo deploy. Para o servidor local (`pnpm dev` em `server/`), põe os mesmos dois valores no `server/.dev.vars`, que está no `.gitignore`.
7. **Pôr o Client ID na app**: `PROJECT_GOOGLE_CLIENT_ID` em `src/cloud/cloud-config.ts` (commit), ou `VITE_GOOGLE_CLIENT_ID` no `.env.local` para testar sem commitar.

## Testar

1. `pnpm dev`. O servidor de produção aceita `http://localhost:5173`, por isso o teste local funciona com os secrets já postos no Worker.
2. Definições → Sincronização → **Ligar ao Google Drive**. Abre a página da Google, que pede autorização e volta a `/nuvem-retorno`. A app retoma nas Definições e pede a palavra-passe da conta.
3. No Google Drive, em **O meu disco**, deve existir a pasta `Faturometro`, com `conta.json` e `alteracoes/`.
4. Noutro browser: **Entrar com conta sincronizada → Entrar com o Google Drive**. Com a mesma palavra-passe, os dados chegam. Isto confirma que a permissão `drive.file` deixa a app encontrar a pasta criada noutro dispositivo.
5. Cópia automática: **Guardar no meu Google Drive** e **Fazer cópia agora**. A cópia aparece em `copias/`.

## O que fica guardado e onde

- No browser: a ligação duradoura (*refresh token*), **cifrada com a chave mestra** no perfil local. Logo após a entrada, enquanto não escreves a palavra-passe, fica só na `sessionStorage` desse separador. O acesso de curta duração (1 hora) fica só em memória.
- No servidor do Faturómetro: só os dois secrets da app. Os pedidos de entrada e de renovação passam pelo servidor sem serem guardados nem registados.
- Na pasta `Faturometro`: o email (`conta.json`) e ficheiros cifrados no dispositivo. A pasta é visível no Drive do utilizador. Se o utilizador a apagar ou mudar de sítio, a app cria uma nova (vazia) no próximo envio.
