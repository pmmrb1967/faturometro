# OneDrive: registo da app na Microsoft

A sincronização pelo OneDrive precisa de um registo da app na plataforma de identidade da Microsoft (Microsoft Entra). Faz-se **uma vez, pelo responsável**; os utilizadores não fazem nada disto (só carregam em "Ligar ao OneDrive" e aceitam o pedido da Microsoft). O id que daí sai **não é secreto**: só identifica a app na página de entrada da Microsoft. Não há segredo de cliente (aplicação de página única, SPA, com PKCE).

Sem id, a app não mostra a opção OneDrive e tudo o resto funciona igual.

**Registo atual** (2026-11-21): id `0af920e6-fd52-456f-9f4d-c1fc3d11f436`, em `src/cloud/cloud-config.ts`. Registada com a conta `rocha.barbosa@netcabo.pt` (é com ela que se entra no portal Entra para mudar a app).

## Que conta usar

O portal Entra só abre com uma conta que tenha um diretório (*tenant*). Uma conta Microsoft pessoal sem diretório (como `faturometro@outlook.com`) dá o erro `AADSTS16000 … does not exist in tenant 'Microsoft Services'`. Soluções:

- registar com outra conta que já tenha diretório (foi o que se fez) — de preferência pessoal: com uma conta do trabalho, a app fica no diretório da empresa;
- ou criar um diretório para a conta pessoal entrando primeiro em <https://portal.azure.com> (pode pedir uma conta Azure gratuita);
- para outra pessoa poder gerir a app: no diretório, **Users → New user → Invite external user**, e depois juntá-la em **Owners** da app.

A conta onde a app está registada não importa para os utilizadores: qualquer conta Microsoft pode ligar o seu OneDrive.

## Passos (portal em inglês, novembro de 2026)

1. Entra em <https://entra.microsoft.com>.
2. No menu da esquerda, em **Entra ID**, abre **App registrations** (ou escreve "App registrations" na pesquisa do topo; atalho: <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>). Não é "Identity Secure Score" nem "External Identities".
3. **+ New registration**:
   - **Name**: `Faturometro` (é o que o utilizador vê ao dar autorização).
   - **Supported account types**: **Any Entra ID Tenant + Personal Microsoft accounts**. Não escolher "Multiple Entra ID tenants": deixa de fora as contas pessoais (@outlook.com, @hotmail.com…). A app usa a autoridade `common`.
   - **Redirect URI**: plataforma **Single-page application (SPA)**, valor `https://app.faturometro.workers.dev/auth-redirect.html`.
   - **Service management reference**: em branco.
   - **Register**.
4. **Authentication** (experiência nova): na linha *Single-page application*, **Edit** (ou **+ Add Redirect URI**) e acrescentar `http://localhost:5173/auth-redirect.html`. A lista fica com os dois endereços, ambos do tipo SPA. No separador **Settings**, *Access tokens* e *ID tokens* (implicit grant) ficam desligados: a app usa o fluxo de código com PKCE.
5. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**: `Files.ReadWrite.AppFolder` e `offline_access` (`openid` e `profile` vêm por defeito). Remover `User.Read` se aparecer: a app não lê o perfil. Não é preciso consentimento de administrador.
6. **Overview**: copiar o **Application (client) ID** e pô-lo em `src/cloud/cloud-config.ts` (`PROJECT_ONEDRIVE_CLIENT_ID`). Em alternativa, `VITE_ONEDRIVE_CLIENT_ID` no ambiente da compilação sobrepõe-se.
7. Opcional, antes de abrir a toda a gente: em **Branding & properties**, página inicial `https://app.faturometro.workers.dev` e declaração de privacidade `https://app.faturometro.workers.dev/privacidade`. Sem editor verificado, a Microsoft mostra a app como "não verificada" no ecrã de autorização; funciona na mesma.

Uma origem nova (por exemplo um domínio próprio) precisa do seu `…/auth-redirect.html` acrescentado no passo 4.

## O que a app faz com isto

- Entrada por redirecionamento (`@azure/msal-browser`, carregado só quando se usa o OneDrive); a página `/auth-redirect.html` recebe a resposta e devolve-a à app.
- A sessão da Microsoft fica no `localStorage` deste browser; o token só vai para a Microsoft.
- Só acede à pasta da app (`/me/drive/special/approot`, que aparece como **Aplicações/Faturometro** ou **Apps/Faturometro** no OneDrive). Lá ficam `conta.json` (email e chave mestra embrulhada), `alteracoes/`, `originais/` e `copias/`, tudo o resto cifrado no dispositivo.
- O nome mostrado em "Ligada ao OneDrive de …" é o email da conta Microsoft (as contas pessoais não dão o nome do dono pelo Graph).
- O cabeçalho CSP (`security-headers.ts`) autoriza `login.microsoftonline.com`, `graph.microsoft.com` e os anfitriões de descarregamento do OneDrive, e `frame-src 'self'` para a renovação silenciosa da sessão.

## Testar

`localhost` só existe no próprio computador, e a Microsoft só devolve a resposta aos endereços registados.

1. `pnpm dev` na porta **5173** (a do endereço registado).
2. Cria uma conta de teste, junta um contrato ou uma fatura, e em **Definições → Sincronização** carrega em **Ligar ao OneDrive**; aceita a autorização e escreve a palavra-passe da conta.
3. No OneDrive deve aparecer a pasta da app com `conta.json` e `alteracoes/`.
4. "Outro dispositivo": janela anónima do Chrome (ou o Edge) em `http://localhost:5173/entrar-sincronizado` → **Entrar com o OneDrive**; os dados aparecem. Acrescenta algo lá, **Sincronizar agora**, e confirma do outro lado.
5. **Cópia automática → Guardar no OneDrive**: aparece uma cópia cifrada em `copias/`.
6. Num telemóvel, só na app publicada.

Testado assim em 2026-11-21, com uma conta Microsoft pessoal.
