# Google Drive e Dropbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync and automatic backups through the user's Dropbox or Google Drive, alongside OneDrive.

**Architecture:** Each service is a `CloudDrive` (`src/cloud/dropbox.ts`, `src/cloud/gdrive.ts`) plus a sign-in through a shared PKCE redirect module (`src/cloud/oauth.ts`) returning to `/nuvem-retorno`. The refresh token lives encrypted with the master key in `ProfileCloud.refreshToken`. Google's code exchange and refresh pass through a stateless server route holding the client secret.

**Tech Stack:** TypeScript strict, React 18, Dexie, zod, WebCrypto, Vitest; server: Cloudflare Worker + D1 (`server/`).

**Spec:** `docs/superpowers/specs/2026-11-21-cloud-google-dropbox-design.md`

## Global Constraints

- Rule 1 (CLAUDE.md): nothing in clear leaves the device except the email in `conta.json`; the server never stores or logs Google tokens or codes.
- No `any`; zod for everything from outside (token responses, API JSON).
- User text in pt-PT (pós-AO90, "tu") in `src/i18n/pt-PT.ts`; code and comments in English.
- Buttons only with `src/components/buttons.css` classes; colours only from tokens.
- Dropbox: authorize `https://www.dropbox.com/oauth2/authorize`, token `https://api.dropboxapi.com/oauth2/token`, `token_access_type=offline`, PKCE S256, no secret; app-folder root `""`; simple upload ≤ 150 MiB.
- Google: authorize `https://accounts.google.com/o/oauth2/v2/auth` (`access_type=offline`, `prompt=consent`, PKCE S256), token `https://oauth2.googleapis.com/token` (server only), scope `https://www.googleapis.com/auth/drive.file`; folder `Faturometro` in My Drive root; multipart upload ≤ 5 MB, resumable above (chunks multiple of 256 KiB).
- Redirect URI for both: `<origin>/nuvem-retorno`.

## Review Focus

1. A sign-in that comes back with an error, a wrong `state`, or after `sessionStorage` was lost: no crash, nothing linked, the page offers to try again. (Task 1)
2. An access token that expires during a sync: one silent renewal, then `needs_reconnect`, never a loop. (Tasks 2, 5)
3. Google Drive with two files of the same name (two devices wrote at once): reads and writes always pick the same one (oldest). (Task 5)
4. A new device signing in with Google/Dropbox before typing the password: the refresh token is never written to IndexedDB in clear. (Task 3)
5. The server token route called with a `redirectUri` from another origin, or without being configured: refused (400 / 404), nothing forwarded. (Task 4)

---

### Task 1: PKCE redirect sign-in and provider registry

**Files:** Create `src/cloud/oauth.ts`, `src/cloud/providers.ts`, `src/cloud/oauth.test.ts`; modify `src/cloud/onedrive-config.ts` → add `PROJECT_DROPBOX_APP_KEY = ''`, `PROJECT_GOOGLE_CLIENT_ID = ''`; rename `src/features/sync/onedrive-return.ts` → `cloud-return.ts`; `src/main.tsx`.

**Interfaces — produces:**
- `type CloudProvider = 'onedrive' | 'dropbox' | 'gdrive'` (in `src/db/profiles.ts`).
- `providers.ts`: `providerAvailable(p): boolean`, `availableProviders(): CloudProvider[]` (order onedrive, gdrive, dropbox), `providerName(p): string` ("OneDrive", "Google Drive", "Dropbox").
- `oauth.ts`: `CLOUD_RETURN_PATH = '/nuvem-retorno'`; `pkcePair(): Promise<{verifier, challenge}>`; `startOAuth({provider, intent, authorizeUrl(challenge, state, redirectUri): string}): Promise<void>` (saves `{provider, intent, verifier, state, returnTo}` in sessionStorage, then `location.assign`); `takeOAuthReturn(url: URL): {provider, intent, code, verifier, redirectUri, returnTo} | {error} | null`.
- `cloud-return.ts`: `CloudIntent = 'enable'|'migrate'|'connect'|'reconnect'`; `startCloudReturn()`; `useCloudReturn(intent): { provider: CloudProvider | null; accountId: string | null; clear(): void }` (OneDrive: MSAL `homeAccountId`; Dropbox/Google: a key into an in-memory/sessionStorage holder of the fresh tokens, see Task 3).

- [ ] Tests: `pkcePair` gives a 43–128 char verifier and the S256 challenge of it; `takeOAuthReturn` returns the code when `state` matches, `{error}` on `?error=` or a wrong state, null on another path; the stored entry is removed after one read.
- [ ] Implement; on start (`main.tsx`), if the path is `/nuvem-retorno`, take the return, `history.replaceState` to `returnTo`, and hand the result to `cloud-return.ts` (exchange done in Task 2/4 per provider).
- [ ] Commit `feat(cloud): PKCE redirect sign-in and cloud provider registry`.

### Task 2: Dropbox drive and sign-in

**Files:** Create `src/cloud/dropbox.ts`, `src/cloud/dropbox-auth.ts`, tests for both.

**Interfaces — produces:** `class Dropbox implements CloudDrive` — `constructor(getToken: () => Promise<string>, {fetch?, sleep?, label?})`; `dropboxAuthorizeUrl(challenge, state, redirectUri)`; `exchangeDropboxCode({code, verifier, redirectUri, fetch?}): Promise<{accessToken, expiresAt, refreshToken}>`; `refreshDropbox(refreshToken, {fetch?}): Promise<{accessToken, expiresAt}>`.

- [ ] Tests with a fake fetch: path mapping (`conta.json` → `/conta.json`); read = `files/download` with etag from `Dropbox-API-Result.rev`, 409 `path/not_found` → null; write modes `overwrite` / `add` (ifNoneMatch) / `update` rev (ifMatch); 409 conflict → `conflict`; `insufficient_space` → `quota_full`; 429 with Retry-After ≤ 30 s retried once, longer → `throttled`; 401 → `needs_reconnect`; network error → `offline`; list = `list_folder` + `continue`, missing folder → []; remove = `delete_v2` (not found ignored); `account()` = `users/get_current_account` email.
- [ ] Implement.
- [ ] Commit `feat(cloud): Dropbox drive and sign-in`.

### Task 3: Provider-generic cloud account, tokens and runs

**Files:** Modify `src/db/profiles.ts` (`ProfileCloud.refreshToken?: EncryptedBlob`), `src/cloud/cloud-run.ts`, `src/cloud/cloud-account.ts`, `src/cloud/migrate.ts`, `src/features/backup/backup-target.ts`, `src/features/sync/sync-store.ts`; create `src/cloud/cloud-tokens.ts` + test.

**Interfaces — produces:**
- `cloud-tokens.ts`: `holdFreshTokens(provider, tokens): string` (key, sessionStorage), `takeFreshTokens(key)`; `tokenSource({provider, refreshToken, refresh})`: caches the access token in memory until 60 s before expiry, renews once on demand, `needs_reconnect` when renewal fails.
- `driveFor(profile, masterKey): CloudDrive` and `driveForNew(provider, accountId)` (the drive right after sign-in, before the profile has it); `enableCloudSync`/`connectFromCloud`/`relinkCloud`/`migrateToCloud` take `provider` and store `refreshToken` encrypted.
- `targetFor(config, profile, masterKey)`.

- [ ] Tests: enable with Dropbox stores `refreshToken` as an `EncryptedBlob` (no token text in the stored profile); connect keeps the token out of IndexedDB until the password unlocks the key; a run renews the access token once on 401 and stops with `needs_reconnect` on the second.
- [ ] Implement; OneDrive keeps MSAL (no `refreshToken`).
- [ ] Commit `feat(cloud): cloud account and runs for any provider`.

### Task 4: Server route for Google tokens

**Files:** `server/src/app.ts`, `server/src/env.ts`, `server/src/app.test.ts`, `server/wrangler.toml` (comment on the two secrets); client `src/cloud/gdrive-auth.ts` + test.

**Interfaces — produces:** `POST /v1/google/token` body `{grant:'code', code, codeVerifier, redirectUri} | {grant:'refresh', refreshToken}` → `{accessToken, expiresIn, refreshToken?}`; 404 when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` missing; 400 when `redirectUri` is not `<allowed origin>/nuvem-retorno`; Google's `invalid_grant` → 401. Client: `googleAuthorizeUrl(challenge, state, redirectUri)`, `exchangeGoogleCode(...)`, `refreshGoogle(refreshToken)`.

- [ ] Server tests with a fake Google fetch: forwards code + verifier + secret; refresh; 404 unconfigured; 400 foreign redirect; nothing written to D1.
- [ ] Implement.
- [ ] Commit `feat(server): stateless Google token exchange`.

### Task 5: Google Drive drive

**Files:** Create `src/cloud/gdrive.ts`, `src/cloud/gdrive.test.ts`.

**Interfaces — produces:** `class GoogleDrive implements CloudDrive` — `constructor(getToken, {fetch?, sleep?, label?})`.

- [ ] Tests with a fake Drive: finds or creates `Faturometro` (oldest if two) and subfolders; read by name (oldest of duplicates), etag = `version`; write creates (multipart) or updates (media PATCH), resumable above 5 MB; ifNoneMatch on an existing name → `conflict`; ifMatch with another version → `conflict`; 403 `storageQuotaExceeded` → `quota_full`; 403/429 rate limits → retry/`throttled`; 401 → `needs_reconnect`; list dedupes names; remove deletes every file of that name; `account()` from `about?fields=user`.
- [ ] Implement.
- [ ] Commit `feat(cloud): Google Drive drive`.

### Task 6: UI for the three services

**Files:** `src/features/sync/CloudSync.tsx`, `ConnectPage.tsx`, `CloudBanner.tsx`, `SettingsPage.tsx`, `AutoBackupSection.tsx`, `src/i18n/pt-PT.ts`.

- [ ] Settings: one block per available service ("Ligar ao Google Drive", …), the server last; the panel names the linked service; reconnect, move-from-server and the moved notice offer the services; connect page one button per service; backup "Guardar no <serviço>"; texts take the service name.
- [ ] Browser smoke test with dummy ids: each button reaches its sign-in page with the right scope and `redirect_uri`.
- [ ] Commit `feat(cloud): Google Drive and Dropbox in settings, sign-in and backups`.

### Task 7: CSP, rules, privacy and guides

**Files:** `security-headers.ts` + test (connect-src `https://api.dropboxapi.com https://content.dropboxapi.com https://www.googleapis.com`), `CLAUDE.md`, `planning/PLAN.md`, privacy text in `src/i18n/pt-PT.ts`, `docs/dropbox.md`, `docs/google-drive.md`, `docs/cloud.md`.

- [ ] CSP test first, then the header.
- [ ] Docs: step-by-step registration for each service (redirect URIs `https://app.faturometro.workers.dev/nuvem-retorno` and `http://localhost:5173/nuvem-retorno`; Dropbox "Scoped access" + "App folder" + scopes `files.metadata.read files.content.read files.content.write account_info.read`; Google consent screen "External", scope `drive.file`, publishing status "In production", OAuth client "Web application", secrets in the Worker with `wrangler secret put`); `docs/cloud.md` index.
- [ ] Commit `docs(cloud): Google Drive and Dropbox in the rules, privacy page and guides`.
