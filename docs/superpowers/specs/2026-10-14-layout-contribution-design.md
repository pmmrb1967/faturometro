# Contribuir com este layout

Data: 2026-10-14 · Estado: aprovado em conversa, à espera de revisão escrita

## Objetivo

Quando a app não conhece o layout de uma fatura (nenhum parser para o fornecedor) ou quando um parser conhecido falha a validação com o QR, o utilizador pode, com consentimento explícito, enviar ao responsável do projeto **só a estrutura anonimizada** da fatura: posições, fontes, etiquetas do modelo, números aleatórios. Com isso o responsável escreve ou corrige o parser, e a próxima pessoa com uma fatura desse fornecedor já não precisa de IA nem de preenchimento manual.

## O que já existe

- Texto do PDF com coordenadas: `PageText[]` / `TextItem` (`src/pdf/text.ts`: `str`, `x`, `y`, `width`, `height`, `fontName`).
- Fixtures: `{ pages: PageText[], qrs: { text: string }[] }` (`src/test/fixtures.ts`); `scripts/generate-parser.ts` propõe um parser a partir de uma fixture.
- Cada fatura guarda `parserId`, `parserVersion` e `validation: 'passed' | 'failed' | 'not_checked'` (`src/domain/types.ts`). Os originais (PDF/fotografia) ficam guardados, cifrados, se a definição `keepOriginalFiles` estiver ligada (predefinição).
- Servidor de sincronização: Cloudflare Worker + D1 (`server/`), com manutenção diária (`server/src/maintenance.ts`, cron), limites para caber no plano gratuito e segredos do Worker (ex.: `ADMIN_EMAILS`).
- Anonimizador local para o responsável (`scripts/anonymize-fixture.ts`), que precisa de uma lista de termos escrita à mão; não serve no browser.

## Decisões

| Decisão | Porquê |
|---|---|
| Envio direto para o servidor, cifrado só para o responsável (chave pública na app, privada só no PC do responsável) | Um clique para o utilizador; o servidor só guarda texto cifrado |
| Anonimização por lista de vocabulário + pré-visualização onde se pode tapar e destapar palavras (opção c) | Recupera etiquetas próprias de cada fornecedor; a pessoa decide, com aviso |
| Números sempre aleatórios; valores pessoais conhecidos sempre tapados, sem forma de destapar | Proteções que não dependem da pessoa |
| Oferecida para layouts desconhecidos e para parsers que falham a validação | Cobre layouts novos e layouts que mudaram |
| Funciona sem conta e sem sincronização | A contribuição não está ligada a nenhuma conta |

## Desenho

### 1. Montar a contribuição (domínio, sem React)

Em `src/features/contribute/`:

- **`vocabulary.ts`**: lista de palavras típicas de faturas portuguesas (etiquetas, unidades, meses, termos de eletricidade, gás, água e telecomunicações, palavras gramaticais curtas), comparadas sem acentos nem maiúsculas. Escrita por nós; não inclui nomes próprios nem topónimos.
- **`skeleton.ts`**: `buildContribution(input)` devolve a contribuição e a lista de palavras tapáveis.
  - Cada `TextItem` mantém `x`, `y`, `width`, `height`, `fontName`; o `str` é partido em palavras, números e separadores.
  - **Números**: cada dígito passa a aleatório, mantendo separadores e comprimento (datas continuam com forma de data, valores com forma de valor). O mesmo número de origem dá o mesmo número aleatório dentro da contribuição (mapa aleatório por contribuição, nunca guardado).
  - **Palavras**: no vocabulário → ficam; fora → tapadas pela forma (`Silva` → `Xxxxx`, mantendo maiúsculas e comprimento).
  - **Sempre tapadas** (não se destapam): palavras que contêm dígitos; emails; palavras que fazem parte de valores pessoais da fatura (NIF do cliente do QR, CPE/CUI, n.º de cliente, n.º de contrato, IBAN, nome e morada se a extração os tiver).
  - `unmask(contribution, word)` / `mask(contribution, word)`: aplicam-se a todas as ocorrências da palavra; recusam as sempre tapadas.
  - **QR**: do texto do QR mantêm-se o NIF do emitente (campo A), o país (C) e o tipo de documento (D); os outros valores passam a aleatórios com o mesmo formato (o NIF do adquirente passa a `999999990`). O resultado continua a ser um texto de QR válido para `parseFiscalQr`.
  - **Contexto**: número de páginas, `parserId` e `parserVersion` tentados (se houver), motivos da falha da validação (códigos, sem valores), versão da app.
- Formato final (JSON): `{ version: 1, createdAt, issuerNif, context, pages: PageText[], qrs: { text }[] }`, compatível com o carregador de fixtures.

### 2. Quando aparece

- Depois de importar uma fatura de PDF com texto, se não houve parser para o fornecedor ou se `validation === 'failed'`: aviso no resultado da importação com "Contribuir com este layout".
- Na lista de faturas, nas faturas nessas condições cujo original PDF está guardado: o mesmo botão (o texto é reextraído do original).
- Fotografias e PDFs sem texto: não aparece.

### 3. Pré-visualização e consentimento

- Página ou painel com cada página desenhada como texto posicionado à escala, palavras tapadas em destaque.
- Tocar numa palavra tapada destapa-a (todas as ocorrências); tocar numa destapada tapa-a. Números e palavras sempre tapadas não reagem.
- Aviso fixo: "Não destapes o teu nome, morada nem outros dados teus."
- Texto de consentimento: o que é enviado, para quem (o responsável do projeto), que vai cifrado e só ele o lê, que serve só para escrever o parser e é apagado depois de usado (e no máximo ao fim de 90 dias no servidor). Caixa de confirmação; só depois o botão "Enviar".
- Resultado: "Obrigado! A contribuição foi enviada." ou o erro (servidor cheio, sem ligação).

### 4. Cifra

- `src/features/contribute/encrypt.ts`: ECDH P-256 com uma chave efémera por contribuição + HKDF-SHA256 + AES-GCM 256, só WebCrypto. O JSON é comprimido (gzip, `CompressionStream`) antes de cifrar.
- Envelope: `{ v: 1, epk (JWK pública efémera), iv, data }` em base64.
- A chave pública do responsável fica em `src/features/contribute/maintainer-key.ts` (JWK). A privada é gerada por `scripts/contrib-keygen.ts` e guardada fora do repositório (caminho por omissão `~/.faturometro/contrib-private.jwk`, ou `CONTRIB_PRIVATE_KEY_FILE`); o script recusa escrever dentro do repositório.

### 5. Servidor

- Migração nova: tabela `contributions(id TEXT PRIMARY KEY, created_at TEXT, size INTEGER, blob TEXT)`.
- `POST /v1/contributions` (sem autenticação): aceita só o envelope (validado com zod), corpo até 256 KB. Limites: 30 por dia e 20 MB guardados no total (valores em `wrangler.toml`, como os outros limites); acima → `503 { error: 'contributions_full' }`. Não guarda IP nem cabeçalhos.
- `GET /v1/contributions` e `DELETE /v1/contributions/:id`: exigem `Authorization: Bearer <CONTRIB_ADMIN_TOKEN>` (segredo do Worker, nunca no repositório); sem token ou errado → 401.
- A manutenção diária apaga contribuições com mais de 90 dias.
- O endereço é o do servidor de sincronização por omissão (`DEFAULT_SYNC_URL`).

### 6. Lado do responsável

- `pnpm contributions:pull`: lê `CONTRIB_ADMIN_TOKEN` e a chave privada, descarrega, decifra, valida, grava em `fixtures/private/contributions/<issuerNif>/<id>.json` (pasta ignorada pelo Git) e apaga do servidor só depois de gravar.
- `docs/parsers.md`: secção curta sobre usar estas fixtures (copiar para `fixtures/private/<providerId>/`, `generate-parser`, fixture sintética).

### 7. Regras e textos

- `CLAUDE.md`, regra 1: o servidor passa a receber também contribuições de layout anonimizadas, cifradas só para o responsável, enviadas por ação explícita do utilizador; a app contacta o servidor sem sincronização só nesse envio.
- Página Privacidade: nova secção "Contribuir com um layout (só se o fizeres)".
- `planning/PLAN.md`: caixa do pós-MVP e decisão na secção 16.
- Textos em `src/i18n/pt-PT.ts`.

## Erros

- Sem ligação ou servidor cheio: mensagem clara; nada fica guardado para reenvio.
- Original em falta ou PDF sem texto: o botão não aparece.
- Contribuição acima de 256 KB depois de comprimida: a app diz que a fatura é grande demais para enviar.

## Testes

- `skeleton`: nenhum número de origem com 3 ou mais dígitos aparece na saída; os valores pessoais nunca aparecem, mesmo depois de `unmask`; o vocabulário fica; o mesmo número de origem dá o mesmo número; posições e fontes iguais às de origem; o QR resultante é válido e mantém só A, C e D.
- `encrypt`: cifrar com a pública e decifrar com a privada devolve o mesmo JSON; outra chave privada falha.
- Servidor: aceita um envelope válido; recusa corpo grande, envelope inválido, acima do limite diário e do total; `GET`/`DELETE` sem token → 401; manutenção apaga as antigas.
- Script: decifra e grava no formato das fixtures (teste com um par de chaves gerado no teste).

## Fora de âmbito

- Contribuições a partir de fotografias.
- Gerar o parser automaticamente no servidor.
- Avisar quem contribuiu quando o parser fica pronto.
