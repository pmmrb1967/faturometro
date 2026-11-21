# Cloud do utilizador: OneDrive, Google Drive e Dropbox

A sincronização entre dispositivos e as cópias automáticas podem ir para a cloud do próprio utilizador, numa pasta só da app e com tudo cifrado no dispositivo. Cada serviço precisa de uma app registada **uma vez, pelo responsável**. Os utilizadores só carregam em "Ligar ao …".

| Serviço | Guia | Id na app (`src/cloud/cloud-config.ts`) | Segredo | Pasta do utilizador |
|---|---|---|---|---|
| OneDrive | [onedrive.md](onedrive.md) | `PROJECT_ONEDRIVE_CLIENT_ID` | nenhum (SPA com PKCE) | Aplicações/Faturómetro |
| Google Drive | [google-drive.md](google-drive.md) | `PROJECT_GOOGLE_CLIENT_ID` | Client secret, só nos secrets do Worker | O meu disco/Faturometro |
| Dropbox | [dropbox.md](dropbox.md) | `PROJECT_DROPBOX_APP_KEY` | nenhum (cliente público com PKCE) | Aplicações/Faturometro |

Um serviço sem id não aparece na app. Para testar um id sem o commitar: `VITE_ONEDRIVE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` ou `VITE_DROPBOX_APP_KEY` no `.env.local`.

## Endereços de regresso

- OneDrive: `https://app.faturometro.workers.dev/auth-redirect.html` e `http://localhost:5173/auth-redirect.html` (tipo SPA).
- Google Drive e Dropbox: `https://app.faturometro.workers.dev/nuvem-retorno` e `http://localhost:5173/nuvem-retorno`.

## Como funciona (para quem mexe no código)

- `src/cloud/drive.ts`: a interface `CloudDrive`, com uma implementação por serviço (`onedrive.ts`, `gdrive.ts`, `dropbox.ts`).
- `src/cloud/cloud-drives.ts`: escolhe a implementação do perfil e trata da entrada em cada serviço.
- `src/cloud/oauth.ts`: PKCE por redirecionamento (Google e Dropbox). O regresso a `/nuvem-retorno` é tratado antes do router (`src/app/cloud-return-start.ts`), que volta à página de onde se saiu.
- `src/cloud/cloud-tokens.ts`: a ligação duradoura (cifrada no perfil) e os acessos de curta duração (só em memória).
- O protocolo de sincronização por ficheiros (`src/cloud/sync-protocol.ts`) é o mesmo nos três serviços.
- Política de segurança (`security-headers.ts`): `connect-src` inclui `api.dropboxapi.com`, `content.dropboxapi.com` e `www.googleapis.com`. As páginas de entrada da Google e da Dropbox abrem por redirecionamento e não precisam de entrada.
