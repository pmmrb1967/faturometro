# CLAUDE.md

Instruções para o Claude Code neste repositório. O plano completo está em `planning/PLAN.md` — lê-o antes de começar qualquer fase.

## O projeto

**Faturómetro**: PWA gratuita e local-first para acompanhar faturas domésticas portuguesas (telecom, eletricidade, gás, água), detetar aumentos e fins de fidelização, e comparar a eletricidade com as ofertas da ERSE. IA opcional com a chave do próprio utilizador. Conta local com palavra-passe e sincronização opcional entre dispositivos, cifrada ponta a ponta.

## Regras invioláveis

1. **Nada de dados pessoais em claro fora do browser.** Não criar analytics nem logs remotos com dados de faturas. O único backend permitido é o servidor de sincronização opcional (`server/`), que só recebe email, hash de autenticação e dados **cifrados ponta a ponta no dispositivo** — nunca dados em claro nem a chave de cifra. Ligações externas a partir da app: `https://api.anthropic.com` (só por ação do utilizador ou definição explícita) e o servidor de sincronização (só se o utilizador a ativar).
2. **Nunca ler, copiar ou commitar ficheiros de `samples/`** para fixtures, testes, prompts ou documentação. Fixtures novas só através de `scripts/anonymize-fixture.ts`, que grava em `fixtures/private/` (ignorada pelo Git). **Fixtures feitas a partir de faturas reais nunca são commitadas**, mesmo anonimizadas: o repositório é público e seriam atribuíveis ao dono. No repositório só entram fixtures sintéticas em `fixtures/<providerId>/`.
3. **Valores monetários em cêntimos inteiros** (`number` inteiro). Nunca somar euros em vírgula flutuante. Conversões só em `src/lib/money.ts`.
4. **A app tem de funcionar sem IA.** Qualquer funcionalidade nova precisa de um caminho sem chave de API.
5. **Toda a extração passa pela validação cruzada com o QR fiscal** (`src/features/ingest/validate.ts`), venha de parser ou de IA.
6. **Não inventar dados de referência** (NIF de fornecedores, regras de IVA, campos do QR, formato ERSE). Usar o que está em `docs/` e nas fixtures; se faltar, parar e perguntar.

## Stack

- Vite + React 18 + TypeScript (`strict: true`)
- Dexie (IndexedDB) + `dexie-react-hooks`
- `pdfjs-dist` para renderizar e extrair texto com coordenadas
- `zxing-wasm` para QR (alternativa: `jsqr`)
- `zod` para validar tudo o que vem de fora (IA, ERSE, importações)
- `@anthropic-ai/sdk` com `dangerouslyAllowBrowser: true`
- `vite-plugin-pwa`
- Vitest (unitários), Playwright (e2e mínimo)
- Gestor de pacotes: pnpm

## Comandos

```bash
pnpm dev              # servidor de desenvolvimento
pnpm test             # vitest
pnpm test:parsers     # só testes de parsers contra fixtures
pnpm typecheck        # tsc --noEmit
pnpm lint
pnpm build
pnpm erse:sync        # atualiza public/data/erse-offers.json
pnpm fixture:anon <pdf> <parserId>   # cria fixture anonimizada
pnpm ai:eval          # avalia a extração por IA nas fixtures (precisa de ANTHROPIC_API_KEY)
pnpm parser:generate <fixture> <id>  # proposta de parser pela IA, para revisão
```

Antes de dar uma tarefa por concluída: `pnpm typecheck && pnpm lint && pnpm test` sem erros.

## Convenções

- **Código, nomes e comentários em inglês. Texto visível ao utilizador em português europeu** (pós-AO90, tratamento por "tu"), centralizado em `src/i18n/pt-PT.ts`.
- Datas em ISO `YYYY-MM-DD`; IDs com `crypto.randomUUID()`.
- Componentes pequenos; lógica de domínio em `src/domain/` sem dependências de React, para ser testável.
- Sem `any`. Tipos partilhados em `src/domain/types.ts`.
- Alterações ao esquema Dexie: nova versão + migração + teste. Nunca alterar uma versão existente.

## Parsers

- Um ficheiro por layout em `src/parsers/<providerId>.ts`, registado em `registry.ts`.
- Interface: `detect(ctx)`, `parse(ctx)`, `id`, `version`, `sectors`.
- Trabalhar sobre `TextItem[]` (texto + coordenadas), nunca sobre o PDF diretamente.
- Devolver confiança por campo; não lançar exceções para campos em falta.
- Cada parser tem testes contra **todas** as fixtures em `fixtures/<providerId>/` (sintéticas, no CI) e em `fixtures/private/<providerId>/` (reais anonimizadas, só localmente; os testes saltam-nas se a pasta não existir). Ao corrigir um parser, subir `version` e acrescentar a fixture que falhava.
- Guia detalhado: `docs/parsers.md`.

## IA

- Sempre por `src/ai/` (abstração `AiProvider`). Nada de chamadas diretas ao SDK espalhadas pela app.
- Saída estruturada (`output_config.format` com JSON schema); validar com zod; uma nova tentativa no máximo.
- Mostrar ao utilizador o que vai ser enviado e o custo estimado antes de enviar (salvo se ativou o envio automático).
- Prompts em `src/ai/prompts/`, versionados.

## Forma de trabalhar

- Seguir as fases de `planning/PLAN.md` por ordem; marcar as caixas concluídas e registar decisões na secção 16.
- Antes de uma tarefa grande, propor um plano curto e esperar confirmação.
- Commits pequenos e descritivos (Conventional Commits).
- Se uma tarefa exigir um dado que não existe no repositório, perguntar em vez de assumir.
