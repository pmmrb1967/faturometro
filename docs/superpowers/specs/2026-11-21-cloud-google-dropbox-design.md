# Google Drive e Dropbox — desenho

Data: 2026-11-21. Continuação de `2026-11-21-cloud-sync-onedrive-design.md` (OneDrive, em produção).

## Intenção

Cada pessoa sincroniza e guarda as cópias automáticas na **sua** cloud: OneDrive, Google Drive ou Dropbox. O servidor do Faturómetro fica como última opção (espaço limitado). Tudo cifrado no dispositivo, como no OneDrive. O responsável regista a app uma vez em cada serviço; os utilizadores só carregam em "Ligar ao …" e aceitam.

## Objetivos

- Dropbox e Google Drive com tudo o que o OneDrive já tem: ligar, entrar num dispositivo novo, ligar de novo, mudar do servidor, originais, cópias automáticas, avisos.
- Guias de registo por serviço (`docs/onedrive.md`, `docs/dropbox.md`, `docs/google-drive.md`) e um índice `docs/cloud.md` (o que vai para o código e o que vai para o Cloudflare).

## Não-objetivos

- Mudar de uma cloud para outra (OneDrive → Dropbox, etc.): desligar e ligar a outra serve; os dados estão no dispositivo.
- Ficheiros acima de 150 MiB no Dropbox (sessões de envio): as cópias e os originais ficam muito abaixo.

## Anti-objetivos

- O servidor guardar ou registar chaves de acesso, códigos ou o que quer que seja das contas Google.
- A app ver ficheiros do utilizador fora da sua pasta.

## Abordagens consideradas (Google)

- **A. Só no browser** (Google Identity Services, token de 1 hora sem renovação): o servidor não toca em nada, mas quase sempre que se abre a app é preciso "Ligar de novo".
- **B. Renovação pelo servidor** (escolhida pelo utilizador): fluxo de código com PKCE; o servidor junta o segredo da app Google ao pedido e passa-o à Google (troca do código e renovação), sem guardar nem registar. Igual ao OneDrive para quem usa.

O Dropbox permite PKCE com renovação no browser, sem segredo: não passa pelo servidor.

## Decisões

- **Pastas.** Dropbox: pasta da app (`Apps/Faturometro`, acesso "App folder"). Google: pasta visível `Faturometro` em O meu Drive, permissão `drive.file` (só os ficheiros criados pela app; não sensível, sem verificação obrigatória). Dentro, as mesmas `conta.json`, `alteracoes/`, `originais/`, `copias/`.
- **Entrada.** Redirecionamento da página inteira (como o OneDrive, por causa do COOP), com PKCE. Regresso a `/nuvem-retorno` (rota da app), que devolve à página que começou e continua a intenção (ligar, mudar, entrar, ligar de novo).
- **Chaves por pessoa.** A chave de renovação fica no browser da pessoa, **cifrada com a chave mestra** dentro do perfil (`ProfileCloud.refreshToken`). Antes da palavra-passe (entrar num dispositivo novo) fica só em `sessionStorage` até ao passo da palavra-passe. A chave de acesso (curta) só em memória.
- **Servidor (Google).** `POST /v1/google/token` com `{grant: 'code', code, codeVerifier, redirectUri}` ou `{grant: 'refresh', refreshToken}`; o servidor junta `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (segredos do Worker) e devolve a resposta da Google. Sem conta do Faturómetro (o dispositivo novo ainda não tem), `redirectUri` só das origens permitidas, sem guardar nem registar. 404 se não estiver configurado.
- **Google Drive sem nomes únicos nem escritas condicionais.** O ficheiro com um nome é o mais antigo com esse nome (`createdTime`); o `etag` é a `version` do ficheiro; "só se não existir" e "só se não mudou" verificam antes de escrever (não atómico; a sincronização já não depende disso: cada dispositivo escreve só os seus ficheiros e numera pela listagem). A pasta `Faturometro` criada por dois dispositivos ao mesmo tempo: fica a mais antiga.
- **Ids das apps** no código (não são segredos), como o do OneDrive, com variáveis `VITE_…` para sobrepor. Um serviço sem id não aparece.
- **Modo da app Google:** tem de estar "In production" (em "Testing" a renovação expira ao fim de 7 dias).

## O que fica para quem constrói

Formato das chamadas de cada API (seguir a documentação oficial), nomes de módulos, textos (português europeu, por "tu"), testes.

## Verificar no teste real

- Dropbox: CORS do `oauth2/token` e leitura do cabeçalho `Dropbox-API-Result` no browser.
- Google: a pasta criada num dispositivo é encontrada pela listagem noutro (mesma app, `drive.file`); `about?fields=user` com `drive.file`.
