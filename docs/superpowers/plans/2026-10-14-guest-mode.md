# Usar a app sem conta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people use the app without an account (no sync, no AI, data not password-protected), and turn that guest profile into a normal account later without re-encrypting anything.

**Architecture:** A guest profile is a `Profile` with `email: ''`, no `wrappedKey` and the raw master key in `guestKey` (base64). Converting it wraps that same master key with a password and a new recovery key and saves the profile in one `put`. Pure rules (`isGuest`, `entryFor`, `aiAvailable`) decide routing and feature gating; the React pages only read them.

**Tech Stack:** React 18 + TS strict, Dexie, WebCrypto, Vitest (+ fake-indexeddb). No React component tests exist in this repo; UI is verified by typecheck, lint, build and a manual smoke run.

**Spec:** `docs/superpowers/specs/2026-10-14-guest-mode-design.md`

## Global Constraints

- Code, names and comments in English; user-visible text in European Portuguese (post-AO90, "tu"), only in `src/i18n/pt-PT.ts`.
- No `any`. Domain logic outside React.
- The `faturometro-profiles` Dexie schema version does not change (indexes unchanged).
- Before calling a task done: `pnpm typecheck && pnpm lint && pnpm test`.
- No guest without the app working: every feature that needs an account shows a "Cria uma conta" path.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Converting a guest whose data was written before conversion: every record must still decrypt after reload with the password (covered in Task 2 test).
2. A browser with a guest **and** password accounts: `/app` must go to `/entrar`, never silently open the guest (Task 3 `entryFor` test).
3. Guest with an `aiApiKey` already in settings (e.g. older data): AI must stay off (Task 4 `aiAvailable` test).
4. Sync code paths reached with a guest profile must fail loudly, not encrypt with `undefined` (Task 2 `wrappedKeyOf` test).
5. Converting with an email that already exists on this browser: error shown, guest untouched (Task 2 test).

---

### Task 1: Crypto helpers for a stored master key

**Files:**
- Modify: `src/lib/crypto.ts`
- Test: `src/lib/crypto.test.ts`

**Interfaces:**
- Produces:
  - `generateMasterKey(): Promise<CryptoKey>`
  - `wrapMasterKey(masterKey: CryptoKey, password: string, iterations?: number): Promise<{ wrapped: WrappedMasterKey; recoveryKey: string }>`
  - `exportMasterKey(masterKey: CryptoKey): Promise<string>` (base64 of the raw key)
  - `importMasterKey(raw: string): Promise<CryptoKey>` (extractable, usages `encrypt`, `decrypt`, `wrapKey`, `unwrapKey`)
  - `createAccountKeys` keeps its signature and now uses the two functions above.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/crypto.test.ts`, add the new names to the import list)

```ts
describe('stored master key', () => {
  it('exports and imports the same master key', async () => {
    const key = await generateMasterKey();
    const blob = await encryptJson(key, { a: 1 });
    const again = await importMasterKey(await exportMasterKey(key));
    expect(await decryptJson(again, blob)).toEqual({ a: 1 });
  });

  it('wraps an existing master key with a password and a recovery key', async () => {
    const key = await generateMasterKey();
    const blob = await encryptJson(key, 'antes');
    const { wrapped, recoveryKey } = await wrapMasterKey(key, 'segredo-longo', ITERATIONS);
    expect(await decryptJson(await unlockWithPassword(wrapped, 'segredo-longo'), blob)).toBe('antes');
    expect(await decryptJson(await unlockWithRecoveryKey(wrapped, recoveryKey), blob)).toBe('antes');
  });

  it('an imported key can be wrapped again', async () => {
    const key = await importMasterKey(await exportMasterKey(await generateMasterKey()));
    await expect(wrapMasterKey(key, 'segredo-longo', ITERATIONS)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/lib/crypto.test.ts` — Expected: FAIL (`generateMasterKey` is not exported).

- [ ] **Step 3: Implement** in `src/lib/crypto.ts` (replace `createAccountKeys`):

```ts
const MASTER_KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'];

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, true, MASTER_KEY_USAGES);
}

/** Raw master key in base64: only for a profile without an account (no password). */
export async function exportMasterKey(masterKey: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', masterKey)));
}

export async function importMasterKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(raw), { name: AES_GCM, length: 256 }, true, MASTER_KEY_USAGES);
}

/** Wraps an existing master key with a password and a new recovery key. */
export async function wrapMasterKey(
  masterKey: CryptoKey,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ wrapped: WrappedMasterKey; recoveryKey: string }> {
  const kdf: PasswordKdf = { algorithm: 'PBKDF2-SHA256', iterations, salt: toBase64(randomBytes(SALT_BYTES)) };
  const recoveryKey = generateRecoveryKey();
  const recoverySalt = toBase64(randomBytes(SALT_BYTES));
  const wrapped: WrappedMasterKey = {
    byPassword: await wrap(masterKey, await passwordKey(password, kdf)),
    kdf,
    byRecoveryKey: await wrap(masterKey, await recoveryKeyKey(recoveryKey, recoverySalt)),
    recoverySalt,
  };
  return { wrapped, recoveryKey };
}

export async function createAccountKeys(password: string, iterations = PBKDF2_ITERATIONS): Promise<NewAccountKeys> {
  const masterKey = await generateMasterKey();
  return { masterKey, ...(await wrapMasterKey(masterKey, password, iterations)) };
}
```

Also use `MASTER_KEY_USAGES` in `unwrap`. Update the file's header comment with one line: a profile without an account keeps the raw master key (no password).

- [ ] **Step 4: Run** `pnpm vitest run src/lib/crypto.test.ts` — Expected: PASS (all crypto tests, old and new).

- [ ] **Step 5: Commit** `feat(crypto): wrap an existing master key; raw export for guests`

---

### Task 2: Guest profile and conversion

**Files:**
- Modify: `src/db/profiles.ts`, `src/features/auth/accounts.ts`, `src/sync/account.ts`
- Test: `src/features/auth/accounts.test.ts`, new `src/db/profiles.test.ts`

**Interfaces:**
- Consumes: Task 1 `generateMasterKey`, `exportMasterKey`, `importMasterKey`, `wrapMasterKey`.
- Produces:
  - `Profile.wrappedKey?: WrappedMasterKey`, `Profile.guestKey?: string`
  - `isGuest(profile: Profile): boolean` (in `src/db/profiles.ts`)
  - `wrappedKeyOf(profile: Profile): WrappedMasterKey` (throws `Error('Profile has no password')` for a guest)
  - `GUEST_EMAIL = ''`
  - `createGuest(): Promise<UnlockedAccount>` (returns the existing guest if there is one)
  - `openGuest(): Promise<UnlockedAccount | null>`
  - `convertGuest(account: UnlockedAccount, email: string, password: string, iterations?: number): Promise<{ profile: Profile; recoveryKey: string }>`
  - `listAccountEmails()` excludes the guest; `unlockAccount`/`recoverAccount` treat the guest as `not_found`.

- [ ] **Step 1: Write the failing tests**

`src/db/profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isGuest, wrappedKeyOf, type Profile } from './profiles';

const guest: Profile = { id: 'g', email: '', createdAt: '2026-10-14T00:00:00.000Z', guestKey: 'AAAA' };

describe('guest profiles', () => {
  it('tells a guest from an account', () => {
    expect(isGuest(guest)).toBe(true);
    expect(isGuest({ ...guest, guestKey: undefined, email: 'a@b.pt', wrappedKey: {} as never })).toBe(false);
  });

  it('refuses the wrapped key of a guest (sync must never run for it)', () => {
    expect(() => wrappedKeyOf(guest)).toThrow('Profile has no password');
  });
});
```

Append to `src/features/auth/accounts.test.ts` (import `createGuest`, `openGuest`, `convertGuest`):

```ts
describe('guest profile', () => {
  it('creates one guest and opens it again with the same key', async () => {
    const guest = await createGuest();
    const blob = await encryptJson(guest.masterKey, 'fatura');
    expect(guest.profile.email).toBe('');
    expect((await createGuest()).profile.id).toBe(guest.profile.id);
    const opened = await openGuest();
    expect(await decryptJson(opened!.masterKey, blob)).toBe('fatura');
    expect(await listAccountEmails()).toEqual([]);
  });

  it('openGuest is null without a guest', async () => {
    expect(await openGuest()).toBeNull();
  });

  it('converts a guest: same data, password and recovery key open it, raw key gone', async () => {
    const guest = await createGuest();
    const blob = await encryptJson(guest.masterKey, 'antes');
    const { profile, recoveryKey } = await convertGuest(guest, ' Ana@Example.PT ', 'segredo-longo', ITERATIONS);
    expect(profile.id).toBe(guest.profile.id);
    expect(profile.email).toBe('ana@example.pt');
    expect(profile.guestKey).toBeUndefined();
    expect((await profilesDb.profiles.get(profile.id))?.guestKey).toBeUndefined();
    expect(await openGuest()).toBeNull();
    const unlocked = await unlockAccount('ana@example.pt', 'segredo-longo');
    expect(await decryptJson(unlocked.masterKey, blob)).toBe('antes');
    const recovered = await recoverAccount('ana@example.pt', recoveryKey, 'outra-longa', ITERATIONS);
    expect(await decryptJson(recovered.masterKey, blob)).toBe('antes');
  });

  it('refuses an email already used here and keeps the guest', async () => {
    await createAccount('ana@example.pt', 'segredo-longo', ITERATIONS);
    const guest = await createGuest();
    await expectCode(convertGuest(guest, 'ANA@example.pt', 'x-segredo-longo', ITERATIONS), 'email_taken');
    expect((await openGuest())?.profile.id).toBe(guest.profile.id);
  });

  it('a guest cannot be opened with a password', async () => {
    await createGuest();
    await expectCode(unlockAccount('', 'qualquer'), 'not_found');
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/db/profiles.test.ts src/features/auth/accounts.test.ts` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

`src/db/profiles.ts`:

```ts
/** One local profile: an account (email + wrapped key) or the guest (no password, raw key). */
export interface Profile {
  id: string;
  /** Empty for the guest (the unique index then allows only one guest). */
  email: string;
  createdAt: string;
  /** Accounts: the master key wrapped by the password and the recovery key. */
  wrappedKey?: WrappedMasterKey;
  /** Guest only: the raw master key in base64, unprotected. */
  guestKey?: string;
  sync?: ProfileSync;
}

export const GUEST_EMAIL = '';

export function isGuest(profile: Profile): boolean {
  return profile.guestKey !== undefined;
}

export function wrappedKeyOf(profile: Profile): WrappedMasterKey {
  if (!profile.wrappedKey) throw new Error('Profile has no password');
  return profile.wrappedKey;
}
```

`src/features/auth/accounts.ts`:
- `findProfile`: also `if (!profile || isGuest(profile)) throw new AccountError('not_found');`.
- Replace every `profile.wrappedKey` / `account.profile.wrappedKey` with `wrappedKeyOf(...)`.
- `createAccount`: keep the `email_taken` check as is (the guest has `''`, never matches a valid email).
- `listAccountEmails`: filter `profile => !isGuest(profile)`.
- Add:

```ts
async function findGuest(): Promise<Profile | undefined> {
  return profilesDb.profiles.where('email').equals(GUEST_EMAIL).first();
}

export async function openGuest(): Promise<UnlockedAccount | null> {
  const profile = await findGuest();
  if (!profile?.guestKey) return null;
  return { profile, masterKey: await importMasterKey(profile.guestKey) };
}

/** The profile without an account; returns the existing one if there is one. */
export async function createGuest(): Promise<UnlockedAccount> {
  const existing = await openGuest();
  if (existing) return existing;
  const masterKey = await generateMasterKey();
  const profile: Profile = {
    id: crypto.randomUUID(),
    email: GUEST_EMAIL,
    createdAt: new Date().toISOString(),
    guestKey: await exportMasterKey(masterKey),
  };
  await profilesDb.profiles.add(profile);
  return { profile, masterKey };
}

/** Turns the guest into an account: same master key and data, now wrapped by a password. */
export async function convertGuest(
  account: UnlockedAccount,
  email: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ profile: Profile; recoveryKey: string }> {
  const normalized = normalizeEmail(email);
  if (await profilesDb.profiles.where('email').equals(normalized).count()) {
    throw new AccountError('email_taken');
  }
  const { wrapped, recoveryKey } = await wrapMasterKey(account.masterKey, password, iterations);
  const { guestKey: _dropped, ...rest } = account.profile;
  const profile: Profile = { ...rest, email: normalized, wrappedKey: wrapped };
  await profilesDb.profiles.put(profile); // one write: never half converted
  return { profile, recoveryKey };
}
```

(If lint flags `_dropped`, build the object explicitly without `guestKey` instead.)

`src/sync/account.ts`: replace each `input.profile.wrappedKey` (lines ~74, 90, 291, 298, 330, 370) with `wrappedKeyOf(input.profile)`; `localWrappedKey: Profile['wrappedKey']` becomes `WrappedMasterKey`.

- [ ] **Step 4: Run** `pnpm vitest run src/db src/features/auth src/sync && pnpm typecheck` — Expected: PASS, no type errors.

- [ ] **Step 5: Commit** `feat(auth): guest profile and conversion to an account`

---

### Task 3: Entry rule and guest session

**Files:**
- Create: `src/features/auth/entry.ts`, `src/features/auth/entry.test.ts`
- Modify: `src/features/auth/RequireSession.tsx`, `src/features/auth/session.tsx`

**Interfaces:**
- Consumes: Task 2 `openGuest`, `isGuest`, `listAccountEmails`.
- Produces: `entryFor(state: { hasGuest: boolean; accounts: number }): 'guest' | 'login'`.

- [ ] **Step 1: Write the failing test** `src/features/auth/entry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { entryFor } from './entry';

describe('entryFor', () => {
  it('opens the guest only when it is the only profile', () => {
    expect(entryFor({ hasGuest: true, accounts: 0 })).toBe('guest');
  });
  it('asks to sign in when there are accounts, even with a guest', () => {
    expect(entryFor({ hasGuest: true, accounts: 1 })).toBe('login');
  });
  it('asks to sign in with no profiles', () => {
    expect(entryFor({ hasGuest: false, accounts: 0 })).toBe('login');
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/features/auth/entry.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/features/auth/entry.ts`:

```ts
/** Where `/app` goes without a session: the guest opens by itself only if it is alone. */
export function entryFor(state: { hasGuest: boolean; accounts: number }): 'guest' | 'login' {
  return state.hasGuest && state.accounts === 0 ? 'guest' : 'login';
}
```

`RequireSession.tsx`: without a session, check once (`useEffect`) with `openGuest()` and `listAccountEmails()`; while checking render `null`; if `entryFor(...) === 'guest'` call `signIn(guest)`; otherwise render the existing `<Navigate to="/entrar" …>`.

```tsx
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, signIn } = useSession();
  const location = useLocation();
  const [entry, setEntry] = useState<'checking' | 'guest' | 'login'>('checking');
  useEffect(() => {
    if (session) return;
    let active = true;
    void (async () => {
      const [guest, emails] = await Promise.all([openGuest(), listAccountEmails()]);
      if (!active) return;
      const next = entryFor({ hasGuest: guest !== null, accounts: emails.length });
      if (next === 'guest' && guest) signIn(guest);
      setEntry(next);
    })();
    return () => {
      active = false;
    };
  }, [session, signIn]);
  if (session) return children;
  if (entry === 'login') return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return null;
}
```

`session.tsx`: `useAutoLock(session !== null && !isGuest(session.profile), lock);` (comment: the guest has nothing to unlock).

- [ ] **Step 4: Run** `pnpm vitest run src/features/auth && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(auth): open the guest by itself when it is the only profile`

---

### Task 4: No AI without an account

**Files:**
- Modify: `src/ai/session.ts`, `src/features/ai/AiSettings.tsx`, `src/features/ai/AiExtractPanel.tsx`, `src/features/ai/ContractAssistant.tsx`, `src/i18n/pt-PT.ts`
- Test: `src/ai/ai.test.ts`

**Interfaces:**
- Consumes: Task 2 `isGuest`.
- Produces: `aiAvailable(profile: Profile, settings: Pick<Settings, 'aiApiKey'>): boolean`; i18n `t.guest.aiNeedsAccount`, `t.guest.createAccount`.

- [ ] **Step 1: Write the failing test** (append to `src/ai/ai.test.ts`):

```ts
describe('aiAvailable', () => {
  const account: Profile = { id: 'a', email: 'a@b.pt', createdAt: '2026-10-14T00:00:00.000Z', wrappedKey: {} as never };
  const guest: Profile = { id: 'g', email: '', createdAt: '2026-10-14T00:00:00.000Z', guestKey: 'AAAA' };
  it('needs an account and a key', () => {
    expect(aiAvailable(account, { aiApiKey: 'sk-ant-x' })).toBe(true);
    expect(aiAvailable(account, {})).toBe(false);
    expect(aiAvailable(guest, { aiApiKey: 'sk-ant-x' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/ai/ai.test.ts` — Expected: FAIL (`aiAvailable` not exported).

- [ ] **Step 3: Implement**

`src/ai/session.ts`:

```ts
/** AI needs an account: a guest's key would sit unprotected in the browser. */
export function aiAvailable(profile: Profile, settings: Pick<Settings, 'aiApiKey'>): boolean {
  return !isGuest(profile) && hasAiKey(settings);
}
```

i18n (new top-level block `guest` in `t`, near `adminBadge`):

```ts
guest: {
  badge: 'Sem conta',
  createAccount: 'Criar conta',
  aiNeedsAccount: 'Cria uma conta para usar a IA: a chave da API fica protegida pela tua palavra-passe.',
  syncNeedsAccount: 'Cria uma conta para sincronizar entre dispositivos.',
  noticeTitle: 'Estás a usar a app sem conta',
  notice: [
    'Os teus dados ficam só neste browser e não estão protegidos por palavra-passe: quem usar este browser consegue vê-los.',
    'Se limpares os dados do site, perdes tudo. Faz uma cópia de segurança (mais abaixo) ou cria uma conta.',
  ],
},
```

- `AiSettings.tsx`: after the `!session || !settings` guard, if `isGuest(session.profile)` render the section title, `copy.intro` and `<p>{t.guest.aiNeedsAccount}</p>` with `<Link to="/criar-conta" className="action-primary">{t.guest.createAccount}</Link>`, and return (no key field).
- `AiExtractPanel.tsx`: `auto` uses `aiAvailable(session.profile, settings)`; the `noKey` line becomes `if (!aiAvailable(session.profile, settings)) return <p className="muted ai-panel">{isGuest(session.profile) ? t.guest.aiNeedsAccount : copy.noKey}</p>;` (use the session already in scope in that component; read it with `useSession()` if it is not).
- `ContractAssistant.tsx`: same replacement for `!settings.aiApiKey`.

- [ ] **Step 4: Run** `pnpm vitest run src/ai && pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ai): AI needs an account`

---

### Task 5: Start without an account (landing, sign-in, header)

**Files:**
- Modify: `src/landing/Landing.tsx`, `src/features/auth/LoginPage.tsx`, `src/app/AppShell.tsx`, `src/i18n/pt-PT.ts`, `src/index.css` (only if the header needs a style for the guest link)

**Interfaces:**
- Consumes: Task 2 `createGuest`, `openGuest`, `isGuest`; Task 4 `t.guest`.
- Produces: i18n `t.landing.startGuest` ('Começar sem conta'), `t.landing.continueGuest` ('Continuar sem conta'), `t.auth.login.continueGuest` ('Continuar sem conta').

No component tests exist; the behaviour rules are tested in Tasks 2–3. Verification here is typecheck, lint, build and the smoke run in Task 7.

- [ ] **Step 1: Landing.** In `hero-actions`, the primary action becomes a button:

```tsx
const { signIn } = useSession();
const navigate = useNavigate();
const [hasGuest, setHasGuest] = useState(false);
useEffect(() => {
  void openGuest().then((guest) => setHasGuest(guest !== null));
}, []);
async function startGuest() {
  signIn(await createGuest());
  navigate('/app');
}
// …
<button type="button" className="button button-primary" onClick={() => void startGuest()}>
  {hasGuest ? copy.continueGuest : copy.startGuest}
</button>
<Link to="/criar-conta" className="button button-quiet">{copy.createAccount}</Link>
```

Keep "Como funciona" as a quiet link after them. (Check `Landing` is inside `SessionProvider` in `main.tsx`; it is if `RegisterPage` can use `useSession`, since both are routes of the same router.)

- [ ] **Step 2: LoginPage.** Load the guest with the emails; when it exists, show under the form:

```tsx
{guest && (
  <p className="auth-alt">
    <button type="button" className="link-button" onClick={() => { signIn(guest); navigate(returnPath, { replace: true }); }}>
      {copy.continueGuest}
    </button>
  </p>
)}
```

Use an existing link-like button class if there is one (`grep -rn "link-button\|button-link" src`); otherwise add `.link-button` to `src/features/auth/auth.css` (no border/background, `color: inherit`-link colour, underline).

- [ ] **Step 3: AppShell header.** For a guest, instead of the email and "Sair":

```tsx
{session && isGuest(session.profile) ? (
  <>
    <span className="topbar-badge">{t.guest.badge}</span>
    <Link to="/criar-conta" className="topbar-lock">{t.guest.createAccount}</Link>
  </>
) : (
  /* existing admin badge, email and Sair button */
)}
```

- [ ] **Step 4: Verify** `pnpm typecheck && pnpm lint && pnpm test` — Expected: all pass.

- [ ] **Step 5: Commit** `feat(ui): start without an account`

---

### Task 6: Settings and account creation for a guest

**Files:**
- Modify: `src/features/settings/SettingsPage.tsx`, `src/features/auth/RegisterPage.tsx`, `src/i18n/pt-PT.ts`

**Interfaces:**
- Consumes: Task 2 `convertGuest`, `isGuest`; Task 4 `t.guest`.
- Produces: i18n `t.auth.register.convertIntro` ('Os dados que já tens passam para a conta. A palavra-passe passa a cifrá-los: sem ela, ninguém os consegue ler, nem nós.').

- [ ] **Step 1: Settings.**
  - `AccountSection`: if `isGuest(session.profile)`, render instead a section `aria-labelledby="guest-title"` with `<h2 id="guest-title">{t.guest.noticeTitle}</h2>`, each `t.guest.notice` paragraph, and `<Link to="/criar-conta" className="action-primary">{t.guest.createAccount}</Link>`.
  - `SyncSection`: if `isGuest(session.profile)`, render the section title, `<p>{t.guest.syncNeedsAccount}</p>` and the same link; no form.
  - "Apagar tudo" (`BackupSection`) needs no change: it deletes the profile by id.

- [ ] **Step 2: RegisterPage conversion mode.** Read `session` from `useSession()`; `const converting = session !== null && isGuest(session.profile);`.
  - Intro: `converting ? copy.convertIntro : copy.intro`; hide the "Já tens conta" line when converting.
  - Submit when converting:

```ts
const { profile, recoveryKey } = await convertGuest(
  { profile: session.profile, masterKey: session.masterKey },
  email,
  password,
);
setCreated({ account: { profile, masterKey: session.masterKey }, recoveryKey });
```

  - `RecoveryKeyStep.onDone`: when converting, `updateProfile(created.account.profile)` (keeps the open database) and `navigate('/app', { replace: true })`; otherwise the current `signIn` path.
  - Error handling is the existing one (`email_taken` message).

- [ ] **Step 3: Verify** `pnpm typecheck && pnpm lint && pnpm test` — Expected: all pass.

- [ ] **Step 4: Commit** `feat(ui): settings and account creation for a guest`

---

### Task 7: Privacy text, plan decision, smoke run

**Files:**
- Modify: `src/i18n/pt-PT.ts` (`privacyPage`), `planning/PLAN.md` (§16)

- [ ] **Step 1: Privacy.** In the section "No teu dispositivo (sempre)", after the first paragraph, add:
  `'Se usares a app sem conta, os dados ficam cifrados com uma chave guardada no próprio browser, sem palavra-passe: quem usar este browser consegue vê-los. Sem conta não há sincronização nem IA. Podes criar uma conta a qualquer momento sem perder nada.'`

- [ ] **Step 2: PLAN.md §16**, new row:
  `| 2026-10-14 | Uso sem conta: perfil com a chave mestra guardada sem palavra-passe no browser (um por browser), sem sincronização nem IA, aviso visível; "Começar sem conta" é a ação principal da página inicial; criar conta embrulha a mesma chave (sem nova cifra) |`

- [ ] **Step 3: Verify** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — Expected: all pass.

- [ ] **Step 4: Smoke run** (`pnpm dev`, browser in a fresh profile):
  1. `/` → "Começar sem conta" → lands in `/app`, header shows "Sem conta" and "Criar conta".
  2. Reload `/app` → opens again without asking anything; no auto-lock.
  3. Definições → guest card, sync and AI say "Cria uma conta".
  4. "Criar conta" → form with the conversion intro → recovery key → back in `/app` with the email in the header.
  5. Reload → `/entrar` asks for the password; the account opens with the same data.

- [ ] **Step 5: Commit** `docs: privacy and plan for use without an account`
