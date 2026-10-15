---
name: novo-leitor
description: Turns the layout contributions waiting on the server into a parser (leitor) for a new supplier or a fix for an existing one — pull, study, write, test, and ask before pushing. Use when the administrator types /novo-leitor or asks to process layout contributions.
---

# /novo-leitor

From the "contribuições de layout por recolher" notice to a published reader. Follow `CLAUDE.md` (rules 1, 2, 5 and 6 above all) and `docs/parsers.md`. Talk to the user in pt-PT.

## 1. Collect

- Run `pnpm contributions:pull`. It reads the token from `CONTRIB_ADMIN_TOKEN` or `~/.faturometro/contrib-admin-token` and the key from `~/.faturometro/contrib-private.jwk`. Never print, copy or commit either file.
- If it fails for a missing token or key, stop and tell the user what is missing (`pnpm contrib:keygen`, `wrangler secret put CONTRIB_ADMIN_TOKEN`).
- Contributions land in `fixtures/private/contributions/<NIF>/<id>.json` (git-ignored). Each one is deleted from the server only after it is written. If there are none, say so and stop.

## 2. Triage, then a short plan

For each NIF folder:

- Is there already a parser for it? Check `issuerNifs` in `src/parsers/*.ts`. If there is, it is a **fix**: the reader failed validation on this invoice. Otherwise it is a **new supplier**.
- Who is it? Use only the issuer NIF in the QR (field A) and the name printed on the document. Never write a NIF from memory (rule 6). If the supplier cannot be identified, ask the user.
- Check for personal data that slipped through the in-app anonymization: names of people, addresses, birth dates, NIFs other than the issuer's. Use a script that reports only counts and positions, never the values.
  - If anything shows up, stop and tell the user. These files are never committed, but they still must not end up in prompts or docs.

Present the plan in a few lines: one bullet per supplier, saying whether it is new or a fix and what will be read (period, lines, readings…). Then wait for confirmation.

## 3. Write

Follow "Passos para um layout novo" in `docs/parsers.md`:

- Copy the fixture to `fixtures/private/<providerId>/`.
- Write the parser in `src/parsers/<providerId>.ts`, anchored on labels; for a fix, bump `version` and `updated`.
- Register it in `registry.ts`.
- Write tests against every fixture.
- Add a synthetic public fixture in `scripts/synthetic-fixtures.ts`, then run `pnpm fixtures:synthetic`.
- Add a row to the layouts table in `docs/parsers.md`.
- Add the supplier to `src/data/known-providers.ts` if it is new.
- Record a decision in `planning/PLAN.md` §16.

Contribution numbers are random, so the lines do not add up. Expect the cross-validation against the QR to fail on the contribution itself. Validate the parser on the synthetic fixture instead, and say in the report that the user's next real invoice is the final check.

## 4. Check

- `pnpm typecheck && pnpm lint && pnpm test`
- `FIXTURES_PUBLIC_ONLY=1 pnpm test` (what the CI runs)
- `pnpm build`
- `git status`: nothing from `fixtures/private/` or `samples/` is staged.

## 5. Publish

- Commit with Conventional Commits, e.g. `feat(parsers): <fornecedor>`.
- **Ask before pushing**: a push is a production deploy.
- After the push, watch the CI (`gh run watch`).
- Tell the user what changes for app users. The app updates itself the next time it is opened. Invoices of this supplier saved with their original show "Ler de novo com o leitor da …".
- The admin notice clears at the next sync.
