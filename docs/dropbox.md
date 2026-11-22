# Dropbox: registo da app

A sincronização pelo Dropbox precisa de uma app registada na consola de programadores do Dropbox. Faz-se **uma vez, pelo responsável**. Os utilizadores não fazem nada disto: só carregam em "Ligar ao Dropbox" e aceitam o pedido do Dropbox. A *App key* que daí sai **não é secreta**, porque só identifica a app na página de entrada. A app não usa o *App secret*: é um cliente público com PKCE.

Sem *App key*, a app não mostra a opção Dropbox e tudo o resto funciona igual.

**Registo atual:** feito (App key `iqmbjnabbdaopun`). A chave está em `PROJECT_DROPBOX_APP_KEY` em `src/cloud/cloud-config.ts`; para testar sem a commitar, usa `VITE_DROPBOX_APP_KEY` no `.env.local`.

## Passos (consola em inglês)

Os nomes dos menus podem mudar com o tempo; se algum não bater certo, procura o equivalente.

1. Entra em <https://www.dropbox.com/developers/apps> com a conta Dropbox que vai gerir a app. Qualquer conta serve: os utilizadores ligam a sua própria conta.
2. **Create app**:
   - **Choose an API**: **Scoped access**.
   - **Choose the type of access you need**: **App folder**. A app só vê a sua pasta (Aplicações/<nome da app>), nunca o resto do Dropbox do utilizador.
   - **Name your app**: `Faturometro`. É o nome da pasta e o que o utilizador vê ao dar autorização. Os textos da app (`src/i18n/pt-PT.ts`, `services.dropbox.folder`) assumem `Aplicações/Faturometro`: se o nome for outro, muda-o lá também.
   - **Create app**.
3. Separador **Permissions**: marca `files.metadata.read`, `files.content.read`, `files.content.write` e `account_info.read` (este último dá o email que aparece nas Definições) e carrega em **Submit**. Na secção **OpenID Scopes** (`profile`, `openid`, `email`) não marques nada: a app não usa o OpenID Connect e lê o email com `account_info.read`. As permissões têm de estar escolhidas **antes** de os utilizadores ligarem; quem ligou antes de uma mudança tem de ligar de novo.
4. Separador **Settings**:
   - **OAuth 2 → Redirect URIs**: acrescenta `https://app.faturometro.workers.dev/nuvem-retorno` e `http://localhost:5173/nuvem-retorno` (um de cada vez, com **Add**).
   - **Allow public clients (Implicit Grant & PKCE)**: **Allow**. Sem isto, a troca do código falha.
   - Copia a **App key** para `src/cloud/cloud-config.ts`. Não copies o *App secret* para lado nenhum.
5. **Estado da app**: começa em *Development*, o que chega para testar e permite ligar até 500 contas. Quando a app passar das 50 contas, o Dropbox dá duas semanas para pedir **Apply for production** (no separador **Settings**); depois disso, deixa de aceitar contas novas até ser aprovada.

## Testar

1. `pnpm dev`, com a chave em `src/cloud/cloud-config.ts` ou em `.env.local` (`VITE_DROPBOX_APP_KEY=…`).
2. Definições → Sincronização → **Ligar ao Dropbox**. Abre a página do Dropbox, que pede autorização e volta a `/nuvem-retorno`. A app retoma nas Definições e pede a palavra-passe da conta.
3. No Dropbox (site ou programa), confirma que existe `Aplicações/Faturometro` com `conta.json` e a pasta `alteracoes/`.
4. Noutro browser: **Entrar com conta sincronizada → Entrar com o Dropbox**. Com a mesma palavra-passe, os dados chegam.
5. Cópia automática: **Guardar no meu Dropbox** e **Fazer cópia agora**. A cópia aparece em `copias/`.

## O que fica guardado e onde

- No browser: a ligação duradoura (*refresh token*), **cifrada com a chave mestra** no perfil local. Logo após a entrada, enquanto não escreves a palavra-passe, fica só na `sessionStorage` desse separador. O acesso de curta duração (4 horas) fica só em memória.
- No servidor do Faturómetro: nada. A troca do código e as renovações vão diretas do browser para `api.dropboxapi.com`.
