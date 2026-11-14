# CLAUDE.md

Instruções para o Claude Code neste repositório. O plano completo está em `planning/PLAN.md` — lê-o antes de começar qualquer fase.

## O projeto

**Faturómetro**: PWA gratuita e local-first para acompanhar faturas domésticas portuguesas (telecom, eletricidade, gás, água), detetar aumentos e fins de fidelização, e comparar a eletricidade com as ofertas da ERSE. IA opcional: gratuita (Workers AI, pelo servidor) ou com a chave do próprio utilizador (Gemini, Claude). Conta local com palavra-passe e sincronização opcional entre dispositivos, cifrada ponta a ponta.

## Regras invioláveis

1. **Nada de dados pessoais em claro fora do browser.** Não criar analytics nem logs remotos com dados de faturas. O único backend permitido é o servidor de sincronização opcional (`server/`), que só recebe email, hash de autenticação e dados **cifrados ponta a ponta no dispositivo** — nunca dados em claro nem a chave de cifra. Recebe também, só por ação explícita do utilizador, contribuições de layout anonimizadas e cifradas com a chave pública do responsável (só ele as decifra). **Exceção: a IA gratuita** (`server/src/ai-free.ts`), por defeito mas só quando o utilizador pede uma leitura (ou ligou o envio automático): o texto da fatura vai em claro mas anonimizado no dispositivo e de novo no servidor (`src/ai/anonymize.ts`); fotografias e digitalizações vão como estão, com aviso antes de enviar. O servidor passa o pedido ao Workers AI e não o guarda nem o regista; guarda só, por dia, `sha256(dia + id aleatório do dispositivo)` com o número de leituras e os neurons gastos. Ligações externas a partir da app: `https://api.anthropic.com` e `https://generativelanguage.googleapis.com` (chave do utilizador, só por ação dele ou definição explícita), o servidor de sincronização (só se o utilizador a ativar, ou para a IA gratuita) e o Cloudflare Web Analytics, só na página inicial e na de privacidade (nunca em `/app` nem onde se escreve a palavra-passe), sem cookies (`src/app/web-analytics.ts`).
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
- `@anthropic-ai/sdk` com `dangerouslyAllowBrowser: true`; Gemini por REST (`src/ai/gemini.ts`); IA gratuita com Workers AI (`@cf/google/gemma-4-26b-a4b-it`) através do servidor
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
- Cores só pelos tokens de `:root` em `src/index.css` (com a versão escura); botões só com as classes de `src/components/buttons.css` (`action-primary`, `action-secondary`, `danger`, `action-wide`, `action-compact`). Nada de cores soltas nem estilos de botão novos no CSS de uma funcionalidade; as únicas exceções são a paleta dos gráficos (tokens próprios em `src/components/chart.css`), a ilustração do talão na página inicial e o visor da câmara.
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

- Sempre por `src/ai/` (abstração `AiProvider`: `FreeProvider`, `GeminiProvider`, `AnthropicProvider`; escolha em `src/ai/session.ts`). Nada de chamadas diretas ao SDK espalhadas pela app.
- A IA gratuita só aceita as tarefas e os prompts da app (o servidor constrói-os ou compara-os): nunca um modelo genérico aberto a qualquer pedido.
- Saída estruturada (`output_config.format` com JSON schema); validar com zod; uma nova tentativa no máximo.
- Mostrar ao utilizador o que vai ser enviado e o custo estimado antes de enviar (salvo se ativou o envio automático).
- Prompts em `src/ai/prompts/`, versionados.

## Forma de trabalhar

- Seguir as fases de `planning/PLAN.md` por ordem; marcar as caixas concluídas e registar decisões na secção 16.
- Antes de uma tarefa grande, propor um plano curto e esperar confirmação.
- Commits pequenos e descritivos (Conventional Commits).
- Se uma tarefa exigir um dado que não existe no repositório, perguntar em vez de assumir.
