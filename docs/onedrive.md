# OneDrive: registo da app na Microsoft

A sincronização pelo OneDrive precisa de um registo da app na plataforma de identidade da Microsoft (Microsoft Entra). Faz-se uma vez, pelo responsável. O id que daí sai **não é secreto**: só identifica a app na página de entrada da Microsoft. Não há segredo de cliente (é uma aplicação de página única, SPA, com PKCE).

Sem id, a app não mostra a opção OneDrive e tudo o resto funciona igual.

## Passos

1. Entra em <https://entra.microsoft.com> com uma conta Microsoft (uma conta pessoal serve; se pedir, cria o diretório gratuito).
2. **Identidade → Aplicações → Registos de aplicações → Novo registo.**
   - Nome: `Faturómetro` (é o que o utilizador vê ao dar autorização).
   - Tipos de conta suportados: **Contas em qualquer diretório organizacional e contas Microsoft pessoais** (multi-inquilino + pessoais). A app usa a autoridade `common`.
   - URI de redirecionamento: plataforma **Aplicação de página única (SPA)**, valor `https://app.faturometro.workers.dev/auth-redirect.html`.
3. Depois de criado, em **Autenticação**, acrescenta outro URI SPA para o desenvolvimento: `http://localhost:5173/auth-redirect.html`. Não ligues os fluxos implícitos (tokens de acesso e de ID): a app usa o fluxo de código com PKCE.
4. Em **Permissões de API → Adicionar uma permissão → Microsoft Graph → Permissões delegadas**, escolhe:
   - `Files.ReadWrite.AppFolder`
   - `offline_access`
   - (`openid` e `profile` já vêm por defeito; o MSAL pede-os sempre.)

   Remove `User.Read` se tiver sido acrescentada automaticamente: a app não lê o perfil. Não é preciso consentimento de administrador.
5. Em **Descrição geral**, copia o **ID da aplicação (cliente)**, um UUID.
6. Põe esse id em `src/cloud/onedrive-config.ts` (`PROJECT_ONEDRIVE_CLIENT_ID`) e faz commit. Em alternativa, define `VITE_ONEDRIVE_CLIENT_ID` no ambiente da compilação (sobrepõe-se ao do ficheiro).
7. Opcional, mas recomendado antes de abrir a toda a gente: em **Marca e propriedades**, preenche a página inicial (`https://app.faturometro.workers.dev`) e a declaração de privacidade (`https://app.faturometro.workers.dev/privacidade`). Sem um editor verificado, a Microsoft mostra a app como "não verificada" no ecrã de autorização; funciona na mesma.

## O que a app faz com isto

- Entrada por redirecionamento (`@azure/msal-browser`, carregado só quando se usa o OneDrive); a página `/auth-redirect.html` recebe a resposta e devolve-a à app.
- A sessão da Microsoft fica no `localStorage` deste browser; o token só vai para a Microsoft.
- Só acede à pasta da app (`/me/drive/special/approot`, que aparece como **Aplicações/Faturómetro** no OneDrive). Lá ficam `conta.json` (email e chave mestra embrulhada), `alteracoes/`, `originais/` e `copias/`, tudo o resto cifrado no dispositivo.
- O cabeçalho CSP (`src/app/security-headers.ts`) já autoriza `login.microsoftonline.com`, `graph.microsoft.com` e os anfitriões de descarregamento do OneDrive.

## Testar

1. `pnpm dev` (porta 5173, a do URI registado).
2. Cria uma conta, vai a **Definições → Sincronização** e carrega em **Ligar ao OneDrive**.
3. Depois de autorizares, a app pede a palavra-passe da conta e faz a primeira sincronização. No OneDrive deve aparecer **Aplicações/Faturómetro** com `conta.json` e `alteracoes/`.
4. Noutro browser (ou numa janela privada), **Entrar com conta sincronizada → Entrar com o OneDrive** traz os dados.
