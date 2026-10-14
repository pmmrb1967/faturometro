# Contribuir com este layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user send, with explicit consent, an anonymized skeleton of an unknown (or failing) invoice layout, encrypted so only the maintainer can read it, and give the maintainer a script that turns it into a private fixture.

**Architecture:** A pure domain module turns `PageText[]` + QR + known personal values into a `Draft` (tokens with originals kept in memory only); `renderContribution(draft)` produces the JSON that leaves the browser (numbers random, unknown words masked unless the user unmasked them, locked words never). The JSON is gzip-compressed and encrypted (ECDH P-256 ephemeral + HKDF + AES-GCM) with the maintainer's public key and POSTed to the sync Worker, which stores only the envelope (D1, daily and total caps, 90-day purge). A maintainer script pulls, decrypts and writes fixtures under `fixtures/private/`.

**Tech Stack:** TS strict, WebCrypto, `CompressionStream`, zod, Vitest; Cloudflare Worker + D1 (`server/`), node:sqlite in server tests; React 18 for the UI.

**Spec:** `docs/superpowers/specs/2026-10-14-layout-contribution-design.md`

## Global Constraints

- Code, names and comments in English; user-visible text in European Portuguese ("tu"), only in `src/i18n/pt-PT.ts`.
- No `any`. Domain logic outside React. zod for everything coming from outside.
- Never read files under `samples/`. Tests use synthetic text only.
- Nothing personal leaves the browser in clear: only `renderContribution` output, encrypted.
- Server: no IP, headers or bodies in logs or tables; secrets only via `wrangler secret put` (`CONTRIB_ADMIN_TOKEN`), never in the repo.
- The maintainer private key never inside the repository.
- Before a task is done: `pnpm typecheck && pnpm lint && pnpm test`.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A personal value that is split across `TextItem`s or mixed with letters (e.g. CPE `PT 0002 … AB`, IBAN, email) must never come out in clear, even after `unmask` (Task 1 tests).
2. Random replacement colliding with the original number: must never output the original digits (Task 1 test with a forced-collision RNG).
3. The QR of the contribution must keep only A, C, D readable and stay parseable by `parseFiscalQr` (Task 1 test).
4. Server limits: oversized body, invalid envelope, 31st of the day, total cap, and admin routes without/with wrong token (Task 3 tests).
5. A user offline or with the server full: a clear message, nothing stored for retry (Task 5, `sendContribution` errors tested in Task 4).

Rulings recorded in the plan: (1) the QR keeps the year of field F (`YYYY0101`), because F is mandatory for `parseFiscalQr`; cost if wrong: the invoice year is visible. (2) The spec's context field "versão da app" is dropped: the app has no version constant (`package.json` is `0.0.0`); `parserId`/`parserVersion` carry what matters. Cost if wrong: one more field later.

---

### Task 1: Skeleton (anonymized draft and output)

**Files:**
- Create: `src/features/contribute/vocabulary.ts`, `src/features/contribute/skeleton.ts`, `src/features/contribute/skeleton.test.ts`

**Interfaces:**
- Produces:

```ts
export type Token =
  | { kind: 'sep'; text: string }
  | { kind: 'num'; text: string } // already random
  | { kind: 'word'; key: string; original: string; shape: string };
export interface DraftItem { x: number; y: number; width: number; height: number; fontName: string; tokens: Token[] }
export interface WordState { key: string; sample: string; count: number; locked: boolean; masked: boolean }
export interface ContributionContext { pages: number; parserId?: string; parserVersion?: string; failures?: string[] }
export interface DraftPage { width: number; height: number; items: DraftItem[] }
export interface Draft { issuerNif: string; pages: DraftPage[]; words: Record<string, WordState>; qrs: string[]; context: ContributionContext }
export interface Contribution { version: 1; createdAt: string; issuerNif: string; context: ContributionContext; pages: PageText[]; qrs: { text: string }[] }
export interface DraftInput { pages: PageText[]; qrs: FiscalQr[]; personal: string[]; context: ContributionContext; random?: () => number }
export function buildDraft(input: DraftInput): Draft
export function setMasked(draft: Draft, key: string, masked: boolean): Draft // locked words ignore unmask
export function renderContribution(draft: Draft, now?: Date): Contribution
export function wordKey(word: string): string // lower case, no accents
export const VOCABULARY: ReadonlySet<string> // keys (wordKey form)
```

- [ ] **Step 1: Write the failing tests** `src/features/contribute/skeleton.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PageText } from '../../pdf/text';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { buildDraft, renderContribution, setMasked, wordKey } from './skeleton';

// Synthetic invoice text only.
function item(str: string, x = 10, y = 10) {
  return { str, x, y, width: 50, height: 8, fontName: 'F1' };
}
const PAGES: PageText[] = [
  {
    width: 595,
    height: 842,
    items: [
      item('Fatura n.º FT 2026/12345'),
      item('Maria Fictícia Exemplar', 10, 30),
      item('Rua Inventada 77, 4000-123 Porto', 10, 40),
      item('CPE PT 0002 0000 1234 5678 AB', 10, 50),
      item('Total a pagar 123,45 €', 10, 60),
      item('Total 123,45', 10, 70),
      item('maria@exemplo.pt', 10, 80),
      item('Cliente 987654', 10, 90),
    ],
  },
];
const QR_TEXT =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20261001*G:FT 2026/12345*H:ABCD-12345*I1:PT*I7:100.37*I8:23.08*N:23.08*O:123.45*Q:abcd*R:1234';
const QR = (parseFiscalQr(QR_TEXT) as { ok: true; qr: FiscalQr }).qr;
const PERSONAL = ['PT 0002 0000 1234 5678 AB', '987654', '123456789'];

function seeded(seed = 1) {
  let state = seed;
  return () => ((state = (state * 48271) % 2147483647) / 2147483647);
}

function draft(random = seeded()) {
  return buildDraft({ pages: PAGES, qrs: [QR], personal: PERSONAL, context: { pages: 1 }, random });
}

const text = (contribution: ReturnType<typeof renderContribution>) =>
  contribution.pages.flatMap((page) => page.items.map((i) => i.str)).join('\n') +
  '\n' +
  contribution.qrs.map((qr) => qr.text).join('\n');

describe('contribution skeleton', () => {
  it('keeps positions and fonts', () => {
    const out = renderContribution(draft());
    expect(out.pages[0]!.items.map(({ x, y, fontName }) => ({ x, y, fontName }))).toEqual(
      PAGES[0]!.items.map(({ x, y, fontName }) => ({ x, y, fontName })),
    );
    expect(out.pages[0]!.width).toBe(595);
  });

  it('replaces every number of 3+ digits and keeps the shape', () => {
    const out = text(renderContribution(draft()));
    for (const number of ['12345', '4000', '123', '0002', '1234', '5678', '987654', '123456789', '20261001']) {
      expect(out).not.toContain(number);
    }
    expect(out).toMatch(/Total a pagar \d{3},\d{2} €/);
  });

  it('maps the same number to the same random number', () => {
    const out = renderContribution(draft());
    const totals = out.pages[0]!.items.filter((i) => i.str.startsWith('Total')).map((i) =>
      i.str.replace(/[^\d,]/g, ''),
    );
    expect(totals[0]).toBe(totals[1]);
  });

  it('never outputs the original digits, even when the RNG would repeat them', () => {
    const zeros = () => 0; // every digit would become 0: "0002" must still change
    expect(text(renderContribution(draft(zeros)))).not.toContain('0002');
  });

  it('keeps vocabulary words and masks the others by shape', () => {
    const out = text(renderContribution(draft()));
    expect(out).toContain('Fatura');
    expect(out).toContain('Total a pagar');
    expect(out).not.toContain('Maria');
    expect(out).not.toContain('Inventada');
    expect(out).toContain('Xxxxx'); // Maria
  });

  it('unmasks a word everywhere, but never a locked one', () => {
    let d = draft();
    d = setMasked(d, wordKey('Porto'), false);
    d = setMasked(d, wordKey('AB'), false); // part of the CPE: locked
    d = setMasked(d, wordKey('maria'), false); // appears in the email: locked
    const out = text(renderContribution(d));
    expect(out).toContain('Porto');
    expect(out).not.toMatch(/\bAB\b/);
    expect(out).not.toContain('maria@');
    expect(d.words[wordKey('Maria')]!.locked).toBe(true);
  });

  it('keeps only A, C and D of the QR, still parseable', () => {
    const out = renderContribution(draft());
    const parsed = parseFiscalQr(out.qrs[0]!.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.qr.issuerNif).toBe('500000000');
    expect(parsed.qr.buyerCountry).toBe('PT');
    expect(parsed.qr.docType).toBe('FT');
    expect(parsed.qr.buyerNif).toBe('999999990');
    expect(out.qrs[0]!.text).not.toContain('123.45');
    expect(out.qrs[0]!.text).not.toContain('ABCD');
    expect(out.issuerNif).toBe('500000000');
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/features/contribute` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`vocabulary.ts`: `export const VOCABULARY: ReadonlySet<string>` built with `wordKey` from a list of words typical of Portuguese invoices: labels and connectors (fatura, recibo, nota, crédito, débito, documento, original, duplicado, n, nº, n.º, data, emissão, vencimento, limite, pagamento, pagar, total, subtotal, valor, valores, iva, taxa, taxas, imposto, impostos, incidência, base, desconto, descontos, acerto, acertos, crédito, saldo, anterior, período, faturação, de, a, o, os, as, do, da, dos, das, em, no, na, nos, nas, por, para, com, sem, e, ou, até, desde, mês, meses, dia, dias, ano, janeiro … dezembro, jan … dez, cliente, contrato, conta, código, referência, entidade, multibanco, débito, direto, iban, nif, contribuinte, morada, local, consumo, instalação, fornecimento, produto, serviço, serviços, plano, tarifa, tarifário, simples, bi-horário, tri-horário, vazio, fora, ponta, cheias, potência, contratada, energia, ativa, reativa, termo, fixo, variável, redes, acesso, kwh, kw, kva, m3, m³, gás, natural, eletricidade, luz, água, saneamento, resíduos, telecomunicações, internet, telefone, telemóvel, televisão, tv, fibra, móvel, chamadas, mensalidade, equipamento, aluguer, fidelização, leitura, leituras, real, estimada, estimativa, contador, escalão, cpe, cui, ponto, entrega, unidade, unidades, quantidade, preço, unitário, euro, euros, eur, pt, contribuição, audiovisual, cav, dgeg, ies, especial, ocupação, subsolo, tos, social, ajustamento, informação, informações, atendimento, apoio, avarias, reclamações, livro, online, www, http, https, página, pág, de, resumo, detalhe, discriminação, encargos, outros, comercializador, operador, distribuição, rede, ERSE, regulada, mercado, livre, oferta, campanha, adesão, eletrónica, papel. Write it as a `string[]` literal in the file, one line per group, and build the set with `new Set(WORDS.map(wordKey))`. No proper names or place names.

`skeleton.ts` (key parts):

```ts
export function wordKey(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const TOKEN = /(\p{L}+)|(\d+)|([^\p{L}\d]+)/gu;

function shapeOf(word: string): string {
  return [...word].map((c) => (c === c.toUpperCase() && c !== c.toLowerCase() ? 'X' : 'x')).join('');
}

function randomDigits(original: string, random: () => number): string {
  let out = '';
  for (let i = 0; i < original.length; i++) {
    const first = i === 0 && original.length > 1 && original[0] !== '0';
    const digit = first ? 1 + Math.floor(random() * 9) : Math.floor(random() * 10);
    out += String(Math.min(digit, 9));
  }
  if (out === original) {
    // Never the original: bump the last digit.
    const last = Number(out.at(-1));
    out = out.slice(0, -1) + String((last + 1) % 10);
  }
  return out;
}
```

`buildDraft`:
1. `numbers = new Map<string, string>()`; `num(text)` returns `numbers.get(text) ?? set(randomDigits(text))`.
2. `lockedKeys`: for every string in `personal` and every QR `buyerNif`, split with `TOKEN` and add `wordKey` of each letter run; also, for every item whose `str` contains `@`, add the keys of all its letter runs.
3. For each item: tokens from `TOKEN`; letters → `{ kind: 'word', key, original, shape: shapeOf(original) }` and count it in `words[key]` (`sample` = first original seen, `locked = lockedKeys.has(key)`, `masked = locked || !VOCABULARY.has(key)`); digits → `{ kind: 'num', text: num(digits) }`; others → `sep`.
4. QRs: for each `qr.raw`, rebuild `A:<issuerNif>*B:999999990*C:<C or PT>*D:<D or FT>*` followed by every other field of the original in order with its value transformed: digit runs → `num(...)`, letter runs → `'X'.repeat(len)` (keep `.`, `-`, `/`, spaces). Field `F` must keep a valid date shape: replace with `num` but then force `YYYYMMDD` validity by using the original year and month (`F:2026` + `num(MMDD)` is not safe) → simplest: `F:` + `YYYY0101` with the original year (F is critical for `parseFiscalQr`; a year is not personal). This is the only clear value kept besides A, C, D.
5. `issuerNif` = first QR's issuer NIF, else `''`.

`setMasked(draft, key, masked)`: returns a copy with `words[key].masked = masked`, unless `words[key].locked` (then unchanged). Unknown key → unchanged.

`renderContribution(draft, now = new Date())`: pages → `{ width, height, items }` (the page `width`/`height` come from the `DraftPage`), each item's `str` = tokens joined, words as `masked ? shape : original`. `version: 1`, `createdAt: now.toISOString()`.

Check `PageText` in `src/pdf/text.ts` for its exact fields (page width/height names) and mirror them.

- [ ] **Step 4: Run** `pnpm vitest run src/features/contribute && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(contribute): anonymized layout skeleton`

---

### Task 2: Encryption, key pair script

**Files:**
- Create: `src/features/contribute/envelope.ts`, `src/features/contribute/envelope.test.ts`, `src/features/contribute/maintainer-key.ts`, `scripts/contrib-keygen.ts`
- Modify: `package.json` (script `contrib:keygen`)

**Interfaces:**
- Produces:

```ts
export interface Envelope { v: 1; epk: JsonWebKey; iv: string; data: string }
export const envelopeSchema: z.ZodType<Envelope>
export async function encryptContribution(value: unknown, publicJwk: JsonWebKey): Promise<Envelope>
export async function decryptContribution(envelope: Envelope, privateJwk: JsonWebKey): Promise<unknown>
export async function generateMaintainerKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }>
export const MAINTAINER_PUBLIC_KEY: JsonWebKey // maintainer-key.ts
```

- [ ] **Step 1: Write the failing test** `envelope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decryptContribution, encryptContribution, envelopeSchema, generateMaintainerKeys } from './envelope';

describe('contribution envelope', () => {
  it('round-trips with the maintainer key pair', async () => {
    const { publicJwk, privateJwk } = await generateMaintainerKeys();
    const value = { hello: 'olá', n: [1, 2, 3] };
    const envelope = await encryptContribution(value, publicJwk);
    expect(envelopeSchema.safeParse(envelope).success).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('olá');
    expect(await decryptContribution(envelope, privateJwk)).toEqual(value);
  });

  it('fails with another private key', async () => {
    const a = await generateMaintainerKeys();
    const b = await generateMaintainerKeys();
    const envelope = await encryptContribution({ x: 1 }, a.publicJwk);
    await expect(decryptContribution(envelope, b.privateJwk)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/features/contribute/envelope.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `envelope.ts`:
  - ECDH P-256: `generateMaintainerKeys` → `crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])`, export both as JWK.
  - `encryptContribution`: ephemeral ECDH pair; `deriveBits` with the maintainer public key (256 bits); HKDF-SHA256 (salt = empty, info = `faturometro-contribution-v1`) → AES-GCM 256 key; payload = gzip(`JSON.stringify(value)`) via `new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))` → `new Response(...).arrayBuffer()`; 12-byte IV; envelope with base64 (use `toBase64`/`fromBase64` from `src/lib/crypto.ts`).
  - `decryptContribution`: reverse; `DecompressionStream('gzip')`; `JSON.parse`.
  - `envelopeSchema`: `z.object({ v: z.literal(1), epk: z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().max(100), y: z.string().max(100) }).passthrough(), iv: z.string().max(40), data: z.string().max(400_000) })`.

  `scripts/contrib-keygen.ts`: writes the private JWK to `process.env.CONTRIB_PRIVATE_KEY_FILE ?? join(homedir(), '.faturometro', 'contrib-private.jwk')` (mode 0o600), refuses if the resolved path is inside `process.cwd()` or the file already exists, and prints the public JWK as a TS literal to paste into `maintainer-key.ts`. `package.json`: `"contrib:keygen": "tsx scripts/contrib-keygen.ts"`.

  Run it once (`pnpm contrib:keygen`) and write the printed public key into `src/features/contribute/maintainer-key.ts`:

```ts
/** Public key of the project maintainer: contributions are readable only with its private pair. */
export const MAINTAINER_PUBLIC_KEY: JsonWebKey = { /* printed by pnpm contrib:keygen */ };
```

- [ ] **Step 4: Run** `pnpm vitest run src/features/contribute && pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(contribute): encrypt contributions for the maintainer` (never add the private key file; it is outside the repo).

---

### Task 3: Server endpoint, limits and purge

**Files:**
- Create: `server/migrations/0003_contributions.sql`
- Modify: `server/src/app.ts`, `server/src/env.ts`, `server/src/worker.ts`, `server/src/maintenance.ts`, `server/wrangler.toml`
- Test: `server/src/app.test.ts`, `server/src/maintenance.test.ts`, `server/src/env.test.ts`

**Interfaces:**
- Produces (HTTP):
  - `POST /v1/contributions` (no token) body = `Envelope` → `201 { id }`; `413` body too large; `400` invalid; `503 { error: 'contributions_full' }`.
  - `GET /v1/contributions` (Bearer `CONTRIB_ADMIN_TOKEN`) → `{ contributions: { id, createdAt, envelope }[] }` (max 20 per call, oldest first).
  - `DELETE /v1/contributions/:id` (same token) → 204.
- `AppConfig` gains `contribAdminToken?: string; contribDailyMax?: number; contribTotalBytes?: number`; `Env` gains `CONTRIB_ADMIN_TOKEN?`, `CONTRIB_DAILY_MAX?`, `CONTRIB_TOTAL_MB?`; `MaintenanceConfig` purges contributions older than `CONTRIB_KEEP_DAYS = 90`.

- [ ] **Step 1: Migration** `server/migrations/0003_contributions.sql`:

```sql
-- Layout contributions (docs/superpowers/specs/2026-10-14-layout-contribution-design.md):
-- only the envelope encrypted for the maintainer, its size and date. No IP, no headers.
CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  envelope TEXT NOT NULL
);
CREATE INDEX contributions_by_date ON contributions (created_at);
```

- [ ] **Step 2: Write the failing tests** (append to `server/src/app.test.ts`; a helper builds an app with `contribAdminToken: 'admin-token', contribDailyMax: 2, contribTotalBytes: 3000`):

```ts
describe('contributions', () => {
  const ENVELOPE = { v: 1, epk: { kty: 'EC', crv: 'P-256', x: 'eA', y: 'eQ' }, iv: 'aXY=', data: 'ZGF0YQ==' };

  it('stores a valid envelope and lists it only with the admin token', async () => {
    const posted = await call('POST', '/v1/contributions', ENVELOPE);
    expect(posted.status).toBe(201);
    expect((await call('GET', '/v1/contributions')).status).toBe(401);
    expect((await call('GET', '/v1/contributions', undefined, 'wrong')).status).toBe(401);
    const listed = await call('GET', '/v1/contributions', undefined, 'admin-token');
    expect(listed.body).toMatchObject({ contributions: [{ id: posted.body!.id, envelope: ENVELOPE }] });
  });

  it('deletes with the admin token', async () => {
    const posted = await call('POST', '/v1/contributions', ENVELOPE);
    expect((await call('DELETE', `/v1/contributions/${posted.body!.id as string}`)).status).toBe(401);
    expect((await call('DELETE', `/v1/contributions/${posted.body!.id as string}`, undefined, 'admin-token')).status).toBe(204);
    expect((await call('GET', '/v1/contributions', undefined, 'admin-token')).body).toEqual({ contributions: [] });
  });

  it('refuses invalid envelopes and big bodies', async () => {
    expect((await call('POST', '/v1/contributions', { v: 2 })).status).toBe(400);
    const big = { ...ENVELOPE, data: 'A'.repeat(400_004) };
    expect((await call('POST', '/v1/contributions', big)).status).toBe(413);
  });

  it('caps contributions per day and in total', async () => {
    expect((await call('POST', '/v1/contributions', ENVELOPE)).status).toBe(201);
    expect((await call('POST', '/v1/contributions', ENVELOPE)).status).toBe(201);
    expect((await call('POST', '/v1/contributions', ENVELOPE)).body).toEqual({ error: 'contributions_full' });
    clock = new Date('2026-10-14T12:00:00Z');
    const bigger = { ...ENVELOPE, data: 'A'.repeat(2000) };
    expect((await call('POST', '/v1/contributions', bigger)).status).toBe(503); // total 3000 reached
  });

  it('without an admin token configured, the admin routes are closed', async () => {
    // default app of this file has no contribAdminToken
    expect((await callDefault('GET', '/v1/contributions', undefined, 'anything')).status).toBe(401);
  });
});
```

(Adapt `call`/`callDefault` to the file's existing helpers: create the contribution app in a nested `beforeEach` and keep a reference to the default handler.)

`maintenance.test.ts`: insert two rows in `contributions` (created 100 and 10 days before `now`), run `runMaintenance`, expect only the recent one left. `env.test.ts`: `limitsFromEnv` maps `CONTRIB_DAILY_MAX: '30'` → `contribDailyMax: 30`, `CONTRIB_TOTAL_MB: '20'` → `contribTotalBytes: 20_000_000`.

- [ ] **Step 3: Run** `pnpm vitest run server` — Expected: FAIL (404s / missing fields).

- [ ] **Step 4: Implement**
  - `app.ts`: constants `CONTRIB_DAILY_MAX = 30`, `CONTRIB_TOTAL_BYTES = 20_000_000`, `MAX_CONTRIBUTION_LENGTH = 400_000` (characters of the raw body). Envelope schema as in Task 2 (duplicate it in the server — the server does not import from `src/`). Route:
    - POST: read `await request.text()`; if `length > MAX_CONTRIBUTION_LENGTH` → `413 'Too large'`; `JSON.parse` + schema → 400; `SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM contributions` and `SELECT COUNT(*) AS n FROM contributions WHERE created_at >= ?` (today 00:00 UTC) → over `contribDailyMax` per day or `bytes + length > contribTotalBytes` → `503 'contributions_full'`; insert `(crypto.randomUUID(), now, length, text)`; `201 { id }`.
    - Admin check: `const token = request.headers.get('Authorization')?.replace(/^Bearer /, '')`; allowed only if `config.contribAdminToken` is set and `sameText(token, config.contribAdminToken)` (constant-time compare of equal-length strings; add a small helper next to `sameHex`).
    - GET: oldest 20, `envelope` parsed back with `JSON.parse`. DELETE `/v1/contributions/:id`.
    - Update the header comment of the file with the three routes.
  - `env.ts`: new fields and mapping (`positive`, `megabytes`); `CONTRIB_ADMIN_TOKEN` is passed separately (not a limit).
  - `worker.ts`: `contribAdminToken: env.CONTRIB_ADMIN_TOKEN` (only if set).
  - `maintenance.ts`: `export const CONTRIB_KEEP_DAYS = 90;` and `DELETE FROM contributions WHERE created_at < ?` with `now - 90 days` ISO.
  - `wrangler.toml` `[vars]`: `CONTRIB_DAILY_MAX = "30"`, `CONTRIB_TOTAL_MB = "20"` with a comment; the token is a secret (comment: `wrangler secret put CONTRIB_ADMIN_TOKEN`).

- [ ] **Step 5: Run** `pnpm vitest run server && pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 6: Commit** `feat(server): receive layout contributions (encrypted, capped)`

---

### Task 4: Sending from the app, pulling on the maintainer side

**Files:**
- Create: `src/features/contribute/send.ts`, `src/features/contribute/send.test.ts`, `scripts/contributions-pull.ts`, `scripts/contributions-pull.test.ts`
- Modify: `package.json` (script `contributions:pull`)

**Interfaces:**
- Consumes: Task 1 `Contribution`; Task 2 `encryptContribution`, `decryptContribution`, `MAINTAINER_PUBLIC_KEY`, `envelopeSchema`.
- Produces:

```ts
export type SendError = 'too_large' | 'full' | 'offline' | 'failed';
export class ContributionError extends Error { readonly code: SendError }
export const MAX_ENVELOPE_LENGTH = 400_000;
export async function sendContribution(contribution: Contribution, options?: { serverUrl?: string; fetch?: typeof fetch; publicKey?: JsonWebKey }): Promise<void>
// scripts/contributions-pull.ts
export async function saveContribution(envelope: unknown, privateJwk: JsonWebKey, root: string, id: string): Promise<string> // returns written path
```

- [ ] **Step 1: Write the failing tests**

`send.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateMaintainerKeys, decryptContribution, envelopeSchema } from './envelope';
import { ContributionError, sendContribution } from './send';
import type { Contribution } from './skeleton';

const CONTRIBUTION: Contribution = {
  version: 1, createdAt: '2026-10-14T00:00:00.000Z', issuerNif: '500000000', context: { pages: 1 },
  pages: [{ width: 595, height: 842, items: [] }], qrs: [],
};

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; body: string }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('sendContribution', () => {
  it('posts an envelope only the maintainer can read', async () => {
    const keys = await generateMaintainerKeys();
    const { fn, calls } = fakeFetch(201, { id: 'x' });
    await sendContribution(CONTRIBUTION, { serverUrl: 'https://sync.example', fetch: fn, publicKey: keys.publicJwk });
    expect(calls[0]!.url).toBe('https://sync.example/v1/contributions');
    const envelope = envelopeSchema.parse(JSON.parse(calls[0]!.body));
    expect(await decryptContribution(envelope, keys.privateJwk)).toEqual(CONTRIBUTION);
  });

  it('maps server and network errors', async () => {
    const keys = await generateMaintainerKeys();
    const send = (fn: typeof fetch) => sendContribution(CONTRIBUTION, { serverUrl: 'https://s', fetch: fn, publicKey: keys.publicJwk });
    await expect(send(fakeFetch(503, { error: 'contributions_full' }).fn)).rejects.toMatchObject({ code: 'full' });
    await expect(send(fakeFetch(413).fn)).rejects.toMatchObject({ code: 'too_large' });
    await expect(send(fakeFetch(500).fn)).rejects.toMatchObject({ code: 'failed' });
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(send(offline)).rejects.toBeInstanceOf(ContributionError);
    await expect(send(offline)).rejects.toMatchObject({ code: 'offline' });
  });
});
```

`scripts/contributions-pull.test.ts`: generate keys, encrypt a `Contribution`, call `saveContribution(envelope, privateJwk, tmpDir, 'abc')`, expect file `tmpDir/500000000/abc.json` whose JSON has `pages` and `qrs` (fixture format); an envelope that fails to decrypt rejects and writes nothing.

- [ ] **Step 2: Run** `pnpm vitest run src/features/contribute/send.test.ts scripts/contributions-pull.test.ts` — Expected: FAIL. (Check `vitest.config` includes `scripts/**/*.test.ts`; `scripts/anonymize/anonymize.test.ts` shows it does.)

- [ ] **Step 3: Implement**
  - `send.ts`: encrypt with `options.publicKey ?? MAINTAINER_PUBLIC_KEY`; `body = JSON.stringify(envelope)`; if `body.length > MAX_ENVELOPE_LENGTH` throw `too_large` before sending; `fetch(`${serverUrl ?? DEFAULT_SYNC_URL}/v1/contributions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })`; network `TypeError` → `offline`; 201 ok; 503 → `full`; 413 → `too_large`; else `failed`.
  - `scripts/contributions-pull.ts`: `saveContribution` validates with `envelopeSchema`, decrypts, checks `{ pages: array, qrs: array, issuerNif: /^\d{9}$|^$/ }`, writes `<root>/<issuerNif || 'unknown'>/<id>.json` (pretty JSON). `main()` (only when run directly): reads `CONTRIB_ADMIN_TOKEN` (env), private key file (env `CONTRIB_PRIVATE_KEY_FILE` or `~/.faturometro/contrib-private.jwk`), server URL (env `SYNC_URL` or `DEFAULT_SYNC_URL`); loops `GET /v1/contributions` → save each into `fixtures/private/contributions` → `DELETE` only after the file is written; prints counts only. `package.json`: `"contributions:pull": "tsx scripts/contributions-pull.ts"`.

- [ ] **Step 4: Run** the same tests + `pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(contribute): send from the app; maintainer pull script`

---

### Task 5: Offer, preview and consent (UI)

**Files:**
- Create: `src/features/contribute/eligible.ts`, `src/features/contribute/eligible.test.ts`, `src/features/contribute/ContributePanel.tsx`, `src/features/contribute/contribute.css`
- Modify: `src/features/ingest/AddInvoice.tsx`, `src/features/ingest/ingest.ts` (export `readPdfWithPasswords`), `src/features/invoices/InvoiceList.tsx`, `src/i18n/pt-PT.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces:

```ts
export function shouldOffer(input: { fileKind: 'pdf' | 'image'; hasText: boolean; parserId?: string; validation?: 'passed' | 'failed' | 'not_checked' }): boolean
export function personalValues(input: { qrs: FiscalQr[]; extraction?: ExtractedInvoice; ownNif?: string }): string[]
// ContributePanel props
{ pages: PageText[]; qrs: FiscalQr[]; personal: string[]; context: ContributionContext; onClose?: () => void }
```

- [ ] **Step 1: Write the failing test** `eligible.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { personalValues, shouldOffer } from './eligible';

describe('shouldOffer', () => {
  it('offers for PDFs with text and no parser or a failed validation', () => {
    expect(shouldOffer({ fileKind: 'pdf', hasText: true })).toBe(true);
    expect(shouldOffer({ fileKind: 'pdf', hasText: true, parserId: 'nos', validation: 'failed' })).toBe(true);
    expect(shouldOffer({ fileKind: 'pdf', hasText: true, parserId: 'nos', validation: 'passed' })).toBe(false);
    expect(shouldOffer({ fileKind: 'pdf', hasText: false })).toBe(false);
    expect(shouldOffer({ fileKind: 'image', hasText: false })).toBe(false);
  });
});

describe('personalValues', () => {
  it('collects the buyer NIF, own NIF and identifiers read by a parser', () => {
    const values = personalValues({
      qrs: [{ buyerNif: '123456789' } as never],
      ownNif: '123456789',
      extraction: {
        customerNumber: { value: 'C-77', confidence: 'high' },
        supplyPointId: { value: 'PT0002000012345678AB', confidence: 'high' },
        lines: [], readings: [], warnings: [],
      },
    });
    expect(values).toEqual(expect.arrayContaining(['123456789', 'C-77', 'PT0002000012345678AB']));
    expect(personalValues({ qrs: [{ buyerNif: '999999990' } as never] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/features/contribute/eligible.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**
  - `eligible.ts`: `shouldOffer` = `fileKind === 'pdf' && hasText && (!parserId || validation === 'failed')`. `personalValues`: buyer NIFs (except `999999990`), `ownNif`, `customerNumber`, `supplyPointId`, `docId` is **not** personal (keep out), deduplicated, non-empty.
  - i18n `t.contribute`:

```ts
contribute: {
  offer: 'A app ainda não conhece bem este layout. Queres ajudar? Envia só a estrutura da fatura, sem os teus dados, para que a próxima seja lida sozinha.',
  open: 'Contribuir com este layout',
  title: 'Contribuir com este layout',
  intro: 'É isto que vai ser enviado. Os números são todos trocados por outros ao acaso. As palavras a cinzento estão tapadas; toca numa para a destapar ou tapar.',
  warning: 'Não destapes o teu nome, morada nem outros dados teus.',
  locked: 'Dados pessoais lidos da fatura: ficam sempre tapados.',
  consent: 'Aceito enviar esta estrutura ao responsável do Faturómetro. Vai cifrada e só ele a consegue ler; serve só para a app passar a ler este layout e é apagada depois de usada (no servidor, no máximo ao fim de 90 dias).',
  send: 'Enviar',
  sending: 'A enviar…',
  sent: 'Obrigado! A contribuição foi enviada.',
  cancel: 'Cancelar',
  errors: {
    too_large: 'Esta fatura é grande demais para enviar.',
    full: 'Não é possível receber contribuições agora. Tenta noutro dia.',
    offline: 'Sem ligação. Tenta outra vez quando estiveres online.',
    failed: 'Não foi possível enviar. Tenta outra vez.',
  },
},
```

  - `ContributePanel.tsx`: on mount `buildDraft({ pages, qrs, personal, context })` (keep in state). Render each page as a `div.contribute-page` with `position: relative`, `aspect-ratio: width / height`, items absolutely positioned at `x/width%`, `y/height%`, font size from `height` scaled (`calc(100cqw * height / pageWidth)` with `container-type: inline-size`). Each item renders its tokens: `word` masked → `<button class="contribute-word masked">` with the shape (locked → `disabled`, title `copy.locked`), unmasked non-vocabulary word → `<button class="contribute-word">` with the original; vocabulary words and numbers/separators as plain text. Clicking toggles `setMasked`. Below: warning, consent checkbox, `Enviar` (disabled until consent), `Cancelar` (`onClose`). On send: `sendContribution(renderContribution(draft))` → status `sent` or the mapped error text. Nothing is stored.
  - `contribute.css`: page box with border, `overflow: hidden`, word buttons inline with no padding; masked words grey background; max width 100% (phone first).
  - `AddInvoice.tsx` (`Outcome`): when `outcome.fileKind === 'pdf'` and `shouldOffer({ fileKind, hasText: outcome.pages.some((p) => p.items.length > 0), parserId: parsed?.parserId, validation: parsed?.check.validation })` for the document shown (QR path: per QR card with its `qr.parsed`; no-QR path: `outcome.parsed`), show `<p className="muted">{copy.offer}</p>` and a button `copy.open` that reveals `<ContributePanel …/>` with `personal = personalValues({ qrs: parsedQrs, extraction: parsed?.extraction, ownNif: settings.ownNif })` and `context = { pages: outcome.pages.length, parserId, parserVersion, failures: parsed?.check.failures }`. Read `ownNif` with `getSettings` (already used in this file) — load it once in `Outcome` with `useLiveQuery`.
  - `InvoiceList.tsx`: for invoices with `shouldOffer({ fileKind: 'pdf', hasText: true, parserId: invoice.parserId, validation: invoice.validation })` and an original in state `local` (only local: no fetch here), show a text button `copy.open`; on click load the original (`documents.getByFileHash`), skip if `mime !== 'application/pdf'`, read it with `(await import('../../pdf/browser')).readPdf` through `readPdfWithPasswords(bytes, [ownNif].filter(Boolean), deps)` (export it from `ingest.ts`), parse the QRs with `parseFiscalQr`, run `runParser` for the extraction (personal values), then open `ContributePanel` below the item. If the PDF has no text or cannot be opened, show `copy.errors.failed`.

- [ ] **Step 4: Run** `pnpm vitest run src/features/contribute && pnpm typecheck && pnpm lint && pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui): offer, preview and send a layout contribution`

---

### Task 6: Rules, privacy, docs; smoke run

**Files:**
- Modify: `CLAUDE.md`, `src/i18n/pt-PT.ts` (`privacyPage`), `planning/PLAN.md`, `docs/parsers.md`

- [ ] **Step 1: CLAUDE.md**, rule 1, after "nunca dados em claro nem a chave de cifra.": add the sentence `Recebe também, só por ação explícita do utilizador, contribuições de layout anonimizadas e cifradas com a chave pública do responsável (só ele as decifra); é o único envio ao servidor sem a sincronização ligada.`

- [ ] **Step 2: Privacy page**: new section after the sync section:

```ts
{
  title: 'Contribuir com um layout (só se o fizeres)',
  body: [
    'Quando a app não conhece o layout de uma fatura, podes enviar a sua estrutura ao responsável do projeto para a app passar a lê-la. Antes de enviar vês exatamente o que sai: as posições do texto, as palavras típicas de faturas e números trocados ao acaso. As outras palavras vão tapadas, e os dados pessoais lidos da fatura nunca se podem destapar.',
    'O envio vai cifrado com uma chave que só o responsável tem e passa pelo mesmo servidor da sincronização, que guarda só o conteúdo cifrado, o tamanho e a data. É apagado depois de usado e, no máximo, ao fim de 90 dias.',
  ],
},
```

- [ ] **Step 3: PLAN.md**: tick `- [x] "Contribuir com este layout" …` and add a §16 row: `| 2026-10-14 | Contribuir com layout: estrutura anonimizada no browser (números ao acaso, vocabulário de faturas, pré-visualização com tapar/destapar, dados pessoais sempre tapados), cifrada com a chave pública do responsável e enviada ao Worker (30/dia, 20 MB, 90 dias); oferecida em layouts desconhecidos e em validações falhadas |`

- [ ] **Step 4: docs/parsers.md**: section "Contribuições de utilizadores": `pnpm contributions:pull` (needs `CONTRIB_ADMIN_TOKEN` and the private key from `pnpm contrib:keygen`), files in `fixtures/private/contributions/<NIF>/`; copy to `fixtures/private/<providerId>/`, then the normal steps (numbers are random, so values do not add up: the parser is checked on the user's next real invoice and on a synthetic fixture).

- [ ] **Step 5: Verify** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — Expected: all pass.

- [ ] **Step 6: End-to-end check.** There is no synthetic PDF of an unknown layout in the repo, so the browser flow is checked after deploy: the user imports a real invoice of an unknown provider (or one whose validation fails), sends a contribution, and the maintainer runs `pnpm contributions:pull`. Record this in the ledger.

- [ ] **Step 7: Commit** `docs: rules, privacy and parser guide for layout contributions`
