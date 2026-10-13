# PLAN.md — Faturómetro

> Plano do MVP. Documento vivo: atualizar as caixas de verificação e a secção "Decisões" à medida que o projeto avança.

---

## 1. Visão

Aplicação web gratuita (PWA), **local-first**, para uma família acompanhar as faturas domésticas — telecomunicações, eletricidade, gás e água —, detetar aumentos e fins de fidelização, e comparar a eletricidade com as ofertas de mercado publicadas pela ERSE.

A IA é **opcional** e funciona com a chave de API do próprio utilizador (BYOK). Sem chave, a app continua útil: leitura do QR fiscal, parsers determinísticos e introdução manual.

## 2. Princípios (não negociáveis)

1. **Os dados ficam no dispositivo.** IndexedDB no browser, cifrado com a palavra-passe da conta local. Só saem do dispositivo se o utilizador ativar a sincronização, e nesse caso cifrados ponta a ponta: o servidor nunca vê dados em claro.
2. **Útil sem IA.** QR fiscal → parser → formulário manual. A IA é um acelerador, não uma dependência.
3. **A IA escreve parsers; não lê todas as faturas.** Layouts conhecidos são extraídos por código determinístico e gratuito. A IA só entra em layouts desconhecidos ou quando a validação falha.
4. **Validação cruzada sempre.** Qualquer extração (parser ou IA) é confrontada com o total do QR fiscal.
5. **Nunca commitar faturas reais nem fixtures feitas a partir delas.** As fixtures reais anonimizadas ficam em `fixtures/private/` (só local); no repositório só entram fixtures sintéticas.
6. **Neutralidade.** Sem comissões, sem afiliados no MVP.

## 3. Âmbito do MVP

**Dentro**
- Upload de PDF e fotografia de fatura em papel
- Leitura do QR fiscal (todas as faturas portuguesas)
- Parsers para os layouts P1 (secção 4)
- Registo de contratos (fornecedor, serviço, fidelização)
- Histórico e gráficos por contrato
- Alertas: fim de fidelização, aumentos, leituras estimadas, fatura em falta
- Comparação de eletricidade com ofertas ERSE (ciclo simples e bi-horário)
- IA BYOK (Anthropic) para extração, explicação de faturas e redação de cartas
- Exportação/importação (ZIP com JSON + PDFs)
- PWA instalável, funciona offline
- Interface responsiva: instalável como app no telemóvel (Android e iOS) e utilizável como website no PC, com o mesmo código
- PDFs protegidos por palavra-passe (ex.: Repsol, cuja palavra-passe é o NIF do titular)
- Landing page pública que explica a app, com entrada e registo
- Conta local (email + palavra-passe) que cifra os dados no dispositivo; vários perfis no mesmo browser
- Sincronização opcional entre dispositivos (telemóvel ↔ PC), cifrada ponta a ponta, escolhida pelo utilizador (secção 11)

**Fora (pós-MVP)**
- Ingestão por email (desenho já definido — secção 12)
- Comparação de telecomunicações e gás com o mercado
- Seguros (auto, casa, vida, …): leitura de apólices, radar de renovações e sugestão de alternativas com coberturas semelhantes e mais económicas (ver secção 15 — fonte de ofertas por confirmar)
- Notificações push (exigem servidor)

## 4. Layouts a cobrir

> Os NIF dos fornecedores **não** devem ser escritos de memória: obtêm-se do campo `A` do QR das faturas reais recolhidas na Fase 0 e registam-se em `src/parsers/registry.ts`.

### P1 — MVP (11 layouts)

| # | Fornecedor | Setor | Porquê primeiro |
|---|---|---|---|
| 1 | MEO | Telecom | Maior quota; fidelizações 24 meses |
| 2 | NOS | Telecom | Idem |
| 3 | Vodafone | Telecom | Idem |
| 4 | DIGI | Telecom | Entrante recente; utilizadores sensíveis a preço |
| 5 | EDP Comercial | Eletricidade | Maior comercializador do mercado livre |
| 6 | SU Eletricidade | Eletricidade | Mercado regulado; referência de comparação |
| 7 | Endesa | Eletricidade | Quota relevante |
| 8 | Iberdrola | Eletricidade | Quota relevante |
| 9 | Galp | Eletricidade (+ gás) | Muitas ofertas duais |
| 10 | Goldenergy | Eletricidade (+ gás) | Quota relevante |
| 11 | Repsol | Eletricidade | Já há amostras reais; PDF protegido por palavra-passe |

### Outras despesas (setor `other`, só acompanhamento)
Despesas sem alternativas de mercado a comparar (ex.: portagens Via Verde): entram pelo QR fiscal (total, IVA, data, fornecedor) e aparecem no histórico e nos alertas de aumento/fatura em falta, mas ficam fora do comparador. Parser dedicado só se o QR não bastar.

### Amostras reais disponíveis (`samples/`)
- NOS (telecom, P1) — 3 faturas; QR na página 1; NIF emitente (campo A) `502604751`
- Repsol (eletricidade + gás, fatura dual, P1; PDF protegido por palavra-passe = NIF do titular) — 3 faturas; QR na página 2; NIF emitente `500246963`. Um documento traz duas faturas (luz e gás), cada uma com o seu ATCUD
- Via Verde (portagens e estacionamento, setor `other`) — 3 extratos + 3 detalhes. **Cada extrato agrupa várias faturas de emitentes diferentes** (Brisa, Infraestruturas de Portugal, AEDL, Empark, CPE, Placegar, Via Verde Portugal…), cada uma com QR desenhado com fonte de código de barras; o leitor atual só descodifica um QR por documento. O detalhe não tem QR e contém o histórico de passagens (local, data, hora)

Faltam amostras dos restantes layouts P1.

### P2 — logo a seguir ao MVP
- Eletricidade: Plenitude, Coopérnico, Luzboa, outros com quota relevante
- Gás natural: layouts de gás de EDP, Galp e Goldenergy (se diferirem da eletricidade)
- Água: entidades gestoras dos utilizadores reais (só acompanhamento de consumo e custo — não há mercado)

### P3 — futuro
- Apólices de seguro (auto, casa, vida associada a crédito)

### Campos a extrair por setor

**Comuns (todas as faturas)** — fornecedor, n.º de cliente/conta, n.º do documento, data de emissão, período de faturação (início/fim), data-limite de pagamento, total, IVA, referência MB/débito direto.

**Telecomunicações**
- Nome do tarifário/pacote
- Mensalidade base, serviços adicionais, equipamentos, descontos (cada um como linha)
- Consumos extra-plafond (chamadas, dados, roaming)
- Data de fim de fidelização (quando presente; senão, pedida ao utilizador uma vez por contrato)

**Eletricidade**
- CPE
- Potência contratada (kVA)
- Ciclo horário (simples, bi-horário, tri-horário) e tipo (diário/semanal)
- Consumo kWh por período (vazio, fora de vazio, cheias, ponta)
- Tipo de leitura (real, estimada, comunicada pelo cliente)
- Preço da energia €/kWh por período, preço da potência €/dia
- Taxas e contribuições (CAV, IEC, taxa DGEG) como linhas
- Indicação de tarifa social

**Gás natural** — CUI, escalão, consumo em m³ e kWh, fator de conversão, preços do termo fixo e da energia, tipo de leitura.

**Água** — consumo m³, escalões aplicados, linhas de água, saneamento e resíduos, tipo de leitura.

## 5. Arquitetura

```
┌──────────────────────── Browser (PWA) ────────────────────────┐
│                                                                │
│  Upload PDF / Foto ─► Pipeline de ingestão ─► Revisão ─► Dexie │
│                        │                                       │
│                        ├─ QR fiscal (zxing-wasm)               │
│                        ├─ Parsers determinísticos (pdf.js)     │
│                        └─ IA BYOK ──────────► api.anthropic.com│
│                                                                │
│  Motor de alertas ◄── Dexie ──► Comparador ERSE ◄── JSON ERSE  │
└────────────────────────────────────────────────────────────────┘
                                        ▲
Servidor estático (Cloudflare Pages) ───┘  app + /data/erse-offers.json
GitHub Action semanal ─► scripts/erse-sync.ts ─► atualiza o JSON
```

O único backend próprio é o servidor de sincronização opcional (secção 11), que só guarda contas e dados cifrados. Alojamento: plano gratuito da Cloudflare (Pages para a app e landing; Workers + D1 + R2 para a sincronização). A API não depende do fornecedor, para se poder mudar (ex.: Hetzner) se os limites gratuitos deixarem de chegar.

Limites do plano gratuito (2026-10, a reconfirmar na Fase 4): Workers 100 000 pedidos/dia e 10 ms de CPU por pedido; D1 5 GB, 5 M linhas lidas/dia, 100 000 linhas escritas/dia (acima disso os pedidos falham); R2 10 GB, 1 M escritas e 10 M leituras/mês, sem custos de saída. Consequências para o desenho:
- O servidor não faz hashing lento de palavras-passe (não cabe em 10 ms): o cliente deriva a chave de autenticação com KDF forte e o servidor guarda só SHA-256 dessa chave (alta entropia).
- Sincronização incremental e em lote, para poupar pedidos e escritas.
- PDFs sincronizados são opcionais (10 GB partilhados por todos os utilizadores).
- Localização dos dados na UE (jurisdição/localização de D1 e R2) a confirmar.

## 6. Pipeline de ingestão

### Etapa 0 — Entrada
- Upload de um ou vários PDFs (drag-and-drop)
- Fotografia com a câmara (`<input type="file" accept="image/*" capture>`)
- Android: Web Share Target ("Partilhar → Faturómetro")

### Etapa 0b — PDF protegido por palavra-passe
- pdf.js deteta a proteção (`PasswordException`).
- Se o utilizador tiver guardado o seu NIF nas definições (apenas local), tentar primeiro com ele; senão, ou se falhar, pedir a palavra-passe.
- A palavra-passe nunca é guardada além do NIF opcional nas definições; o hash de deduplicação é do ficheiro original.
- `scripts/anonymize-fixture.ts` recebe a palavra-passe por variável de ambiente (`FIXTURE_PDF_PASSWORD`), nunca por ficheiro commitado.

### Etapa 1 — Deduplicação
- SHA-256 do ficheiro. Se já existir, avisar e parar.
- Após o QR: chave secundária `NIF emitente + identificação do documento (campo G)`.

### Etapa 2 — QR fiscal
1. PDF: renderizar cada página com pdf.js a escala 2–3 para canvas; tentar descodificar com zxing-wasm. Parar na primeira página com QR válido.
2. Imagem: descodificar diretamente; se falhar, tentar com rotação e aumento de contraste.
3. Interpretar a string: campos `chave:valor` separados por `*`.
4. Validar: campos obrigatórios presentes, data válida, total numérico.
5. Se não houver QR (faturas antigas, digitalizações más), continuar sem ele e marcar `qrStatus = 'missing'`.

**Campos do QR fiscal relevantes** (confirmar contra a especificação técnica oficial da AT antes de implementar):

| Campo | Conteúdo |
|---|---|
| A | NIF do emitente |
| B | NIF do adquirente |
| D | Tipo de documento (FT, FR, NC, …) |
| E | Estado do documento |
| F | Data do documento (AAAAMMDD) |
| G | Identificação única do documento |
| H | ATCUD |
| I1–I8 | Espaço fiscal e bases/IVA por taxa (Continente) |
| J*, K* | Idem para Açores e Madeira |
| N | Total de impostos |
| O | Total do documento com impostos |

Notas de crédito (`D = NC`) entram como valores negativos.

### Etapa 3 — Identificação do fornecedor
1. NIF do emitente (campo A) → `registry.ts` → parser.
2. Sem QR: impressão digital do texto (expressões características do layout) → parser.
3. Sem correspondência → layout desconhecido → Etapa 6 (IA) ou Etapa 7 (manual).

### Etapa 4 — Parser determinístico
- Entrada: `TextItem[]` do pdf.js (`getTextContent`) com texto e coordenadas, normalizado (espaços, vírgula decimal, `€`).
- Cada parser exporta `detect()`, `parse()`, `version` e os setores suportados.
- Saída: `Partial<ExtractedInvoice>` com **confiança por campo** (`high` / `low`).
- Parser que lança exceção nunca bloqueia a ingestão: regista o erro e passa à etapa seguinte.

### Etapa 5 — Validação cruzada
- Total extraído = campo `O` do QR (tolerância 0,01 €)
- Soma de IVA extraída = campo `N` do QR (tolerância 0,01 €)
- Início do período ≤ fim do período ≤ data de emissão + 5 dias
- Eletricidade: soma dos consumos por período = consumo total, quando ambos existem

Falha em qualquer verificação → `validation = 'failed'` e os campos envolvidos passam a confiança `low`.

### Etapa 6 — IA (opcional)
Corre apenas se houver chave configurada **e**: layout desconhecido, validação falhada, ou campos obrigatórios em falta. Por defeito pede confirmação antes de enviar ("Enviar esta fatura para a Anthropic? Custo estimado: ~X cêntimos"). Definição opcional: "enviar automaticamente".

- Envia o PDF como bloco `document` (ou a imagem), com instruções e um esquema JSON via tool use.
- Resposta validada com zod. Inválida → uma nova tentativa com o erro; depois desiste.
- Resultado passa de novo pela Etapa 5 (validação com o QR).

### Etapa 7 — Formulário manual
Pré-preenchido com tudo o que já foi extraído. Pede só os campos em falta, por setor.

### Etapa 8 — Revisão
- Primeira fatura de cada contrato: revisão obrigatória.
- Seguintes: revisão só se houver campos com confiança `low`.
- Correções do utilizador ficam registadas em `fieldCorrections` (ajudam a melhorar parsers — apenas localmente).

### Etapa 9 — Pós-processamento
- Associar a contrato existente (NIF + n.º de cliente/CPE) ou criar novo
- Recalcular alertas
- Guardar o PDF original como Blob (opcional por definição, para poupar espaço)

## 7. Esquema de dados (Dexie)

Convenções: valores monetários em **cêntimos inteiros**; datas em ISO `YYYY-MM-DD`; IDs com `crypto.randomUUID()`.

```ts
type Sector = 'telecom' | 'electricity' | 'gas' | 'water' | 'other';
type Confidence = 'high' | 'low';
type Source = 'qr' | 'parser' | 'ai' | 'manual';

interface Provider {
  id: string;
  nif: string;                // campo A do QR
  name: string;
  sectors: Sector[];
  parserId?: string;
}

interface Contract {
  id: string;
  providerId: string;
  sector: Sector;
  label: string;              // "Internet casa", "Luz"
  customerNumber?: string;
  supplyPointId?: string;     // CPE (luz) ou CUI (gás)
  tariffName?: string;
  loyaltyEndDate?: string;    // fim de fidelização
  electricity?: {
    powerKva: number;
    cycle: 'simple' | 'bi' | 'tri';
    cycleType?: 'daily' | 'weekly';
    socialTariff: boolean;
  };
  active: boolean;
  createdAt: string;
}

interface Invoice {
  id: string;
  contractId: string;
  providerId: string;
  fileHash: string;
  docType: string;            // FT, FR, NC…
  docId?: string;             // campo G
  atcud?: string;
  issueDate: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  totalCents: number;
  vatCents?: number;
  qrStatus: 'ok' | 'missing' | 'invalid';
  validation: 'passed' | 'failed' | 'not_checked';
  sources: Partial<Record<string, Source>>;          // origem de cada campo
  confidence: Partial<Record<string, Confidence>>;
  parserId?: string;
  parserVersion?: string;
  createdAt: string;
}

interface InvoiceLine {
  id: string;
  invoiceId: string;
  kind: 'base_fee' | 'addon' | 'equipment' | 'discount' | 'usage'
      | 'energy' | 'power' | 'tax' | 'other';
  description: string;
  amountCents: number;
  quantity?: number;
  unit?: 'kWh' | 'm3' | 'day' | 'month' | 'min' | 'GB';
  unitPrice?: number;         // €/unidade, até 6 casas decimais
  period?: 'empty' | 'off_empty' | 'full' | 'peak'; // vazio, fora vazio, cheias, ponta
}

interface Reading {           // energia, gás, água
  id: string;
  invoiceId: string;
  contractId: string;
  period?: InvoiceLine['period'];
  quantity: number;
  unit: 'kWh' | 'm3';
  readingType: 'real' | 'estimated' | 'customer';
  dateFrom: string;
  dateTo: string;
}

interface StoredDocument {
  id: string;
  invoiceId?: string;
  fileHash: string;
  mime: string;
  blob: Blob;
  addedAt: string;
}

interface Alert {
  id: string;
  contractId: string;
  kind: 'loyalty_ending' | 'price_increase' | 'estimated_readings'
      | 'missing_invoice' | 'cheaper_offer';
  severity: 'info' | 'warning';
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
  dismissedAt?: string;
}

interface FieldCorrection {
  id: string;
  invoiceId: string;
  field: string;
  extracted: unknown;
  corrected: unknown;
  source: Source;
  createdAt: string;
}

interface Settings {           // registo único, id = 'settings'
  id: 'settings';
  aiProvider?: 'anthropic';
  aiApiKey?: string;           // opcionalmente cifrada com passphrase
  aiModel?: string;
  aiAutoSend: boolean;
  ownNif?: string;             // NIF do titular, para abrir PDFs protegidos (só local)
  keepOriginalFiles: boolean;
  priceIncreaseThresholdPct: number;   // default 5
  loyaltyAlertDays: number[];          // default [60, 30, 7]
}
```

Índices Dexie (v1):

```ts
db.version(1).stores({
  providers: 'id, nif',
  contracts: 'id, providerId, sector, active',
  invoices: 'id, contractId, providerId, &fileHash, issueDate, [providerId+docId]',
  invoiceLines: 'id, invoiceId',
  readings: 'id, invoiceId, contractId, dateTo',
  documents: 'id, invoiceId, &fileHash',
  alerts: 'id, contractId, kind, dismissedAt',
  fieldCorrections: 'id, invoiceId',
  settings: 'id',
});
```

Qualquer alteração ao esquema = nova versão Dexie com migração e teste.

## 8. Comparador de eletricidade (ERSE)

- A ERSE disponibiliza as ofertas comerciais do simulador em formato de base de dados.
- **Fase 0:** confirmar URL, formato, frequência de atualização e condições de reutilização dos dados.
- `scripts/erse-sync.ts` descarrega, normaliza e grava `public/data/erse-offers.json` com data de versão. GitHub Action semanal faz commit se houver alterações.
- A app mostra sempre a data dos dados ("ofertas ERSE de AAAA-MM-DD").

**Cálculo anual estimado por oferta**
```
custo = preço_potência_dia × 365
      + Σ (consumo_anual_período × preço_energia_período)
      + taxas fixas
      + IVA (regras específicas da eletricidade — tabela configurável)
```
- Consumo anual: soma dos últimos 12 meses de `readings`; se houver menos, extrapolar e indicar a incerteza.
- Distribuição por período (vazio/fora de vazio): a real, se o ciclo atual for bi-horário; senão, perfil típico configurável com aviso.
- As regras de IVA e taxas em vigor têm de ser confirmadas e cobertas por testes com faturas reais (o cálculo da fatura atual tem de bater com o total real ± 2%).
- Mostrar: custo atual estimado, 5 ofertas mais baratas, poupança anual, condições relevantes (fidelização, débito direto, fatura eletrónica, descontos só para novos clientes).
- Linguagem: "estimativa", nunca "poupança garantida".

## 9. Alertas

| Alerta | Regra |
|---|---|
| Fim de fidelização | 60, 30 e 7 dias antes de `loyaltyEndDate` |
| Aumento de preço | Mensalidade base > anterior, ou total > média dos 3 meses anteriores + limiar % |
| Leituras estimadas | 3 ou mais faturas seguidas com leitura estimada |
| Fatura em falta | Contrato ativo sem fatura há mais de 40 dias |
| Oferta mais barata | Poupança estimada ≥ 30 €/ano (configurável) |

Notificações apenas dentro da app no MVP; um contador no ícone da PWA via Badging API, quando suportada.

## 10. IA (BYOK)

- **Fornecedor inicial:** Anthropic. Abstração `AiProvider` para adicionar outros depois.
- **Chamadas diretas do browser**, com `dangerouslyAllowBrowser: true` no SDK. A chave nunca passa por servidor nosso.
- **Guardar a chave:** IndexedDB, dentro dos dados do perfil, cifrada com a chave da conta local (secção 11).
- **Modelo configurável;** por defeito o modelo mais económico que extraia com fiabilidade (avaliar na Fase 4).
- **Usos:**
  1. Extração estruturada (tool use + zod)
  2. "Explica-me esta fatura" / "porque subiu?" — com contexto das últimas faturas do contrato
  3. Redação de cartas: pedido de renegociação, denúncia de contrato, reclamação de leitura estimada
- **Transparência:** mostrar sempre o que vai ser enviado e o custo estimado; registar tokens usados por chamada (só localmente).
- **Ferramenta de desenvolvimento (não incluída na app):** `scripts/generate-parser.ts` — recebe uma fixture anonimizada de um layout novo e pede ao Claude uma proposta de parser + testes, para revisão humana.

## 11. Privacidade e segurança

- CSP restritiva: `connect-src 'self' https://api.anthropic.com <origem do servidor de sincronização>`.
- Sem analytics com dados pessoais; se houver métricas, apenas agregadas e sem cookies.
- `samples/` (faturas reais) está no `.gitignore`.
- `scripts/anonymize-fixture.ts`: converte um PDF real numa fixture JSON de `TextItem[]` com NIF, nomes, moradas, CPE, IBAN e n.º de cliente substituídos por valores fictícios coerentes (mesmo comprimento e formato).
- Exportação completa em ZIP; botão "apagar todos os dados".
- Aviso ao utilizador (sem sincronização): os dados vivem neste browser; limpar dados do site apaga tudo; fazer exportações regulares.

### Contas locais
- Registo com email (identificador) e palavra-passe; tudo no dispositivo, sem servidor.
- Chave derivada da palavra-passe (WebCrypto: PBKDF2-SHA256 com sal aleatório, ou Argon2id via WASM — decidir na Fase 1) → chave mestra aleatória AES-GCM que cifra os dados do perfil. Mudar a palavra-passe só re-cifra a chave mestra.
- Cada perfil tem a sua base Dexie. Os campos indexados ficam limitados a IDs, datas e hashes; o resto do registo vai cifrado.
- A chave só existe em memória; bloqueio automático após inatividade (configurável).
- Sem recuperação de palavra-passe: na criação, mostrar uma **chave de recuperação** para guardar e explicar que sem ela os dados se perdem.
- Esquema preparado para sincronizar desde a v1: `updatedAt` em todos os registos e tombstones (`deletedAt`) em vez de apagar.

### Sincronização opcional (cifrada ponta a ponta)
- Desligada por defeito; o utilizador escolhe "só neste dispositivo" ou "sincronizar entre dispositivos" e pode mudar a qualquer momento. Desligar apaga os dados do servidor.
- Da palavra-passe derivam-se duas chaves independentes: uma de autenticação (o servidor guarda só um hash dela) e uma de cifra (nunca sai do dispositivo).
- O servidor guarda: email, hash de autenticação, a chave mestra cifrada, e registos cifrados com ID, versão e data. Nunca dados em claro.
- PDFs originais: sincronização opcional, também cifrados (armazenamento de objetos compatível com S3).
- Conflitos: last-write-wins por registo, com `updatedAt` e versão do servidor.
- RGPD: política de privacidade, exportação e apagamento da conta pelo próprio utilizador.

## 12. Ingestão por email (pós-MVP — desenho de referência)

Opcional e desligada por defeito.
1. Ao ativar, o browser gera um par de chaves (WebCrypto). A privada fica no dispositivo; a pública vai para o servidor com um endereço aleatório (`x7k2p9@faturas.<domínio>`).
2. Cloudflare Email Routing + Email Worker: aceita só anexos PDF (limite de tamanho, opcionalmente só de domínios conhecidos), cifra em memória com a chave pública, guarda só o blob cifrado (R2/KV). O corpo do email nunca é gravado.
3. A app recolhe, decifra localmente, processa pelo pipeline normal, e o servidor apaga. Blobs não recolhidos expiram em 30 dias.
4. Endereço regenerável; texto claro na ativação sobre a passagem pelo servidor.
5. Não usar OAuth do Gmail nem IMAP.

## 13. Fases e tarefas

### Fase 0 — Preparação
- [x] Criar repositório, `pnpm create vite` (React + TS), ESLint, Prettier, Vitest
- [x] Recolher faturas reais para `samples/` — NOS, Repsol, Via Verde (3 de cada); restantes P1 por obter (só com consentimento)
- [x] Confirmar especificação do QR fiscal (documento oficial da AT) e guardar resumo em `docs/qr-fiscal.md`
- [x] Confirmar fonte, formato e condições de reutilização dos dados da ERSE; resumo em `docs/erse-data.md` (em aberto: IVA nos preços, licença formal)
- [x] Escrever `scripts/anonymize-fixture.ts` (palavra-passe via `FIXTURE_PDF_PASSWORD`; termos sensíveis em `samples/anonymize.local.json`)
- **Concluída quando:** existem fixtures anonimizadas (locais) para os layouts com amostras disponíveis e os dois documentos de referência. Os layouts P1 sem amostras ficam cobertos por QR + manual (+ IA) até haver PDFs cedidos com consentimento.

### Fase 1 — Núcleo local + QR
- [ ] Landing page (o que é, privacidade, como funciona, instalar no telemóvel) e rotas (`/` landing, `/app` aplicação)
- [ ] Conta local: registo, entrada, bloqueio, chave de recuperação, vários perfis (secção 11)
- [ ] Esquema Dexie v1 (com `updatedAt`/`deletedAt`, campos sensíveis cifrados) e camada de repositórios (`src/db/`)
- [ ] Upload de PDF/imagem, hash e deduplicação
- [ ] Renderização com pdf.js e leitura de QR (zxing-wasm)
- [ ] Parser da string QR + testes com exemplos reais anonimizados
- [ ] Formulário manual por setor
- [ ] Ecrã de revisão
- [ ] Lista de contratos e faturas
- **Concluída quando:** qualquer fatura portuguesa com QR entra na app com total, IVA, data e fornecedor corretos, sem IA.

### Fase 2 — Parsers P1
- [ ] Infraestrutura: `ParserContext`, utilitários de texto/coordenadas, registo por NIF e fingerprint
- [ ] Validação cruzada (Etapa 5)
- [ ] Parsers telecom: MEO, NOS, Vodafone, DIGI
- [ ] Parsers eletricidade: EDP Comercial, SU Eletricidade, Endesa, Iberdrola, Galp, Goldenergy, Repsol
- [ ] Fixtures sintéticas por layout em `fixtures/<providerId>/` (estrutura real, valores inventados e coerentes com o QR), para o CI
- [ ] Testes de cada parser contra todas as fixtures do layout (sintéticas + privadas, quando existem)
- **Concluída quando:** ≥ 95% das fixtures P1 passam a validação cruzada com todos os campos obrigatórios.

### Fase 3 — Histórico, alertas e comparador
- [ ] Gráficos por contrato (custo mensal, consumo)
- [ ] Motor de alertas (secção 9) + testes
- [ ] `scripts/erse-sync.ts` + GitHub Action
- [ ] Comparador de eletricidade (secção 8), validado contra faturas reais
- **Concluída quando:** o custo estimado da oferta atual bate com as faturas reais ± 2% em todas as fixtures de eletricidade.

### Fase 4 — Sincronização opcional
- [ ] Reconfirmar limites do plano gratuito da Cloudflare e localização dos dados na UE
- [ ] Servidor: contas (email + hash de autenticação), API de sincronização de registos cifrados, armazenamento de PDFs cifrados
- [ ] Cliente: ativar/desativar sincronização, envio e receção incrementais, resolução de conflitos
- [ ] Apagar conta e dados do servidor; política de privacidade
- [ ] Testes: o servidor nunca recebe dados em claro (teste automático sobre os pedidos)
- **Concluída quando:** uma fatura adicionada no telemóvel aparece no PC, e o servidor só contém dados cifrados.

### Fase 5 — IA BYOK
- [ ] Ecrã de definições com chave, modelo, teste de ligação
- [ ] Extração por IA com tool use + zod + revalidação QR
- [ ] Avaliação: comparar a extração por IA com os parsers nas fixtures; escolher modelo por defeito
- [ ] "Explica-me esta fatura" e cartas
- [ ] `scripts/generate-parser.ts`
- **Concluída quando:** uma fatura de layout desconhecido é extraída por IA e passa a validação com o QR.

### Fase 6 — Polimento e lançamento
- [ ] PWA (vite-plugin-pwa): instalação, offline, Web Share Target
- [ ] Exportar/importar ZIP; apagar tudo
- [ ] CSP, cabeçalhos de segurança
- [ ] Página "Privacidade" e "Como funciona"
- [ ] Deploy (app estática e servidor de sincronização)
- [ ] Teste com 5–10 famílias (uso real durante 1 mês)

### Pós-MVP
- [ ] Layouts P2
- [ ] Ingestão por email (secção 12)
- [ ] "Contribuir com este layout": o utilizador envia, com consentimento explícito, só a estrutura anonimizada de um layout desconhecido
- [ ] Gás no comparador; telecom com lista de ofertas mantida manualmente
- [ ] Seguros (P3)

## 14. Estrutura de pastas

```
faturometro/
├── CLAUDE.md
├── PLAN.md
├── docs/
│   ├── qr-fiscal.md
│   ├── erse-data.md
│   └── parsers.md            # como escrever um parser novo
├── samples/                  # faturas reais — NUNCA commitar (.gitignore)
├── fixtures/                 # fixtures sintéticas, commitadas
│   ├── private/              # fixtures de faturas reais anonimizadas — NUNCA commitar (.gitignore)
│   └── <parserId>/*.json
├── public/
│   └── data/erse-offers.json
├── scripts/
│   ├── anonymize-fixture.ts
│   ├── erse-sync.ts
│   └── generate-parser.ts
└── src/
    ├── app/                  # rotas, layout
    ├── components/
    ├── features/
    │   ├── ingest/           # pipeline (etapas 0–9)
    │   ├── contracts/
    │   ├── alerts/
    │   ├── compare/
    │   └── settings/
    ├── db/                   # Dexie, esquema, migrações, repositórios
    ├── qr/                   # leitura e interpretação do QR fiscal
    ├── pdf/                  # pdf.js: render, extração de texto
    ├── parsers/
    │   ├── registry.ts
    │   ├── types.ts
    │   ├── utils.ts
    │   └── <fornecedor>.ts
    ├── ai/                   # AiProvider, prompts, esquemas zod
    ├── domain/               # tipos, cálculo de custos, regras de alerta
    └── lib/                  # money (cêntimos), datas, crypto
```

## 15. Riscos e questões em aberto

| Risco | Mitigação |
|---|---|
| Layouts mudam sem aviso | Validação QR deteta a falha; fallback IA/manual; fixtures novas e correção rápida |
| Dados ERSE mudam de formato | Script com validação de esquema; a app usa a última versão válida |
| Regras de IVA/taxas da eletricidade complexas | Tabela configurável + testes contra faturas reais |
| Utilizador perde dados ao limpar o browser | Avisos, lembretes de exportação, sincronização cifrada pós-MVP |
| Fim de fidelização não aparece na fatura | Pedir ao utilizador uma vez por contrato |
| Custos de IA para o utilizador | Confirmação prévia com custo estimado; parsers cobrem os casos comuns |
| PDFs protegidos por palavra-passe | Tentar o NIF guardado nas definições; senão pedir ao utilizador |

**Questões em aberto**
- Seguros: abordagem proposta abaixo, por confirmar.

**Seguros — proposta (2026-10-13, por confirmar)**

Pesquisa: não foi encontrada fonte pública com preços de todas as seguradoras. A ASF tem um comparador oficial só para PPR. Os comparadores privados (ComparaJá, Mudey, QueSeguro, …) são mediadores, sem API pública conhecida, e os preços dependem do perfil de cada pessoa (condutor, veículo, imóvel, idade), por isso só existem por simulação individual. Fazer scraping desses sites violaria os seus termos e enviaria dados pessoais para servidores de terceiros (contra o princípio 1).

Proposta, sem servidor e sem afiliados:
1. **Ler a apólice** (parser/IA/manual) para um perfil de coberturas estruturado: coberturas, capitais, franquias, prémio, data de renovação.
2. **Radar de renovação:** alerta antes da data de renovação e comparação do prémio com o ano anterior.
3. **Kit de simulação:** resumo das coberturas atuais e dos dados pedidos pelos simuladores, com ligações neutras para comparadores e seguradoras; o utilizador simula fora da app.
4. **Comparar propostas recebidas:** o utilizador carrega as propostas (PDF ou manual) e a app compara-as com a apólice atual cobertura a cobertura, assinalando o que falta ou é inferior e a diferença de preço.
5. Avaliar no futuro parcerias com mediadores (implica decidir sobre neutralidade e envio de dados).

## 16. Decisões

| Data | Decisão |
|---|---|
| 2026-10-13 | Local-first, sem backend no MVP |
| 2026-10-13 | IA opcional, BYOK, chamadas diretas do browser |
| 2026-10-13 | Ingestão por email adiada para pós-MVP, opcional e cifrada |
| 2026-10-13 | Valores monetários em cêntimos inteiros |
| 2026-10-13 | Nome do projeto: Faturómetro (pasta e repositório: `faturometro`; confirmar domínio e marca no INPI) |
| 2026-10-13 | Repositório público em github.com/pmmrb1967/faturometro; licença por decidir; `samples/` e todos os PDF no `.gitignore` |
| 2026-10-13 | Uma só base de código: PWA instalável no telemóvel e website no PC (layout responsivo, mobile-first); `vite-plugin-pwa` configurado logo na Fase 0 |
| 2026-10-13 | Suporte a PDFs protegidos por palavra-passe, com NIF opcional guardado localmente |
| 2026-10-13 | Via Verde e outras despesas sem alternativas de mercado: setor `other`, só acompanhamento, fora do comparador |
| 2026-10-13 | Repsol promovida a P1 (11 layouts) |
| 2026-10-13 | Contas locais com email + palavra-passe que cifram os dados no dispositivo (Fase 1) |
| 2026-10-13 | Sincronização opcional entre dispositivos, cifrada ponta a ponta, numa fase própria (Fase 4) após o núcleo; regra 1 do `CLAUDE.md` alterada em conformidade; "Local-first, sem backend no MVP" substituída |
| 2026-10-13 | Landing page pública na Fase 1 |
| 2026-10-13 | Alojamento no plano gratuito da Cloudflare (Pages + Workers + D1 + R2); a Hetzner não tem plano gratuito (VPS desde ~5–7 €/mês). API independente do fornecedor |
| 2026-10-13 | Fonte ERSE: `Settings.json` → `csvPath` (ZIP com 2 CSV); formato em `docs/erse-data.md`. QR fiscal: especificação AT v1.1 resumida em `docs/qr-fiscal.md` |
| 2026-10-13 | Fixtures de faturas reais (mesmo anonimizadas) ficam só no PC, em `fixtures/private/`; no repositório público só fixtures sintéticas |
| 2026-10-13 | Não usar faturas de terceiros encontradas na internet; layouts em falta só com PDFs cedidos com consentimento |
| 2026-10-13 | Fase 0 com React 18 e ESLint (conforme `CLAUDE.md`), TypeScript 6.0 (o typescript-eslint ainda não suporta o 7) |
