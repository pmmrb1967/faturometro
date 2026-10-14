# Como escrever um parser de layout

Um parser lê os dados de uma fatura que o código QR fiscal não tem (período, data-limite, n.º de cliente, CPE/CUI, linhas, leituras) a partir do texto do PDF com coordenadas. O total e o IVA vêm sempre do QR; o parser lê-os também, para a validação cruzada.

## Peças

| Ficheiro | O que faz |
|---|---|
| `src/parsers/types.ts` | `Parser`, `ParserContext`, `ExtractedInvoice` (cada campo com `confidence`) |
| `src/parsers/utils.ts` | Linhas por coordenadas (`rows`), `findItem`, `valueBelow`, `valueRightOf`, `amount`, `date`, `dayMonthRange`, `quantity`, `decimalString` |
| `src/parsers/registry.ts` | Lista de parsers; escolha por NIF do emitente (campo A do QR) e, sem QR, por `detect()` |
| `src/features/ingest/validate.ts` | Validação cruzada (passo 5): total e IVA contra o QR (±1 cêntimo), período, soma das linhas, leituras contra kWh faturados |
| `src/test/fixtures.ts` | Carrega fixtures públicas (`fixtures/<id>/`) e privadas (`fixtures/private/<id>/`) |

## Passos para um layout novo

1. **Fixtures privadas.** Com PDFs reais (teus ou cedidos com consentimento) em `samples/`:
   `pnpm fixture:anon samples/<ficheiro>.pdf <providerId>` → `fixtures/private/<providerId>/`. Nunca são commitadas.
2. **Estudar o layout** nas fixtures privadas: etiquetas, colunas (x) e linhas (y). Os valores estão anonimizados; as etiquetas do modelo não.
3. **NIF do emitente**: o campo A do QR nas fixtures. Não escrever NIF de memória.
4. **Parser** em `src/parsers/<providerId>.ts`:
   - trabalhar só sobre `ctx.pages` (`TextItem[]`), ancorando em etiquetas (`findItem` + `valueBelow`/`valueRightOf`) e não em posições absolutas;
   - num ficheiro com vários QR, `parse(ctx, qr)` recebe o QR do documento a ler (ex.: Repsol encontra a página pelo n.º do documento);
   - nunca lançar exceções por campos em falta: deixar o campo vazio e, se for estranho, acrescentar a `warnings`;
   - `confidence: 'high'` quando o valor vem de uma etiqueta conhecida; `'low'` quando é um palpite (ex.: formato nunca visto);
   - `linesIncludeVat` quando as linhas da fatura incluem IVA (NOS); senão as linhas somam o total sem IVA (Repsol);
   - indicar `basis` (real, estimada, acerto) nas linhas de consumo quando a fatura o diz;
   - documento com faturas de emitentes diferentes (Indaqua + Município): `issuerName` com o nome impresso do outro emitente e `contractLabel` quando o serviço pede um contrato próprio (ex.: "Resíduos");
   - telecom: `telecomServices` (internet, TV, fixo, telemóvel) quando a fatura lista o que o pacote inclui; servem para a pesquisa no COM.escolha (`docs/anacom-comescolha.md`).
5. **Registar** em `src/parsers/registry.ts`.
6. **Testes** em `src/parsers/<providerId>.test.ts` contra todas as fixtures do layout, e entrada em `src/parsers/validation.test.ts`.
7. **Fixture sintética pública** em `scripts/synthetic-fixtures.ts`: mesmas etiquetas e posições, valores inventados e coerentes (as linhas somam, o QR bate). `pnpm fixtures:synthetic` reescreve-as.
8. Confirmar sem as privadas, como no CI: `FIXTURES_PUBLIC_ONLY=1 pnpm test`.

## Contribuições de utilizadores

Na app, "Contribuir com este layout" envia a estrutura anonimizada de uma fatura que nenhum parser conhece (ou cujo parser falhou a validação), cifrada com a chave pública do responsável (`src/features/contribute/maintainer-key.ts`).

1. Uma vez: `pnpm contrib:keygen` (a chave privada fica em `~/.faturometro/contrib-private.jwk`, fora do repositório; guarda uma cópia) e `wrangler secret put CONTRIB_ADMIN_TOKEN` no Worker.
2. `CONTRIB_ADMIN_TOKEN=… pnpm contributions:pull` → `fixtures/private/contributions/<NIF do emitente>/<id>.json` (ignorada pelo Git); cada contribuição só sai do servidor depois de gravada.
3. Copiar para `fixtures/private/<providerId>/` e seguir os passos acima. Os números são aleatórios (o mesmo número de origem dá o mesmo número), por isso as linhas não somam: o parser confirma-se na fixture sintética e na próxima fatura real.

## Ao corrigir um parser

Subir `version` (fica guardada em cada fatura) e acrescentar às fixtures privadas a fatura que falhava.

## Layouts atuais

| Parser | NIF (campo A) | Notas |
|---|---|---|
| `nos` | 502604751 | Resumo com IVA incluído; mensalidade faturada adiantada (o período termina depois da data da fatura); serviços do bloco "Informação sobre o seu pacote" |
| `generali` | 500940231 | Generali Seguros, "Fatura/Recibo" de prémio (automóvel, casa…): um QR; isento de IVA (o imposto do selo é o campo M do QR e uma linha `tax`); linhas com IVA "incluído" (somam o total); período coberto; produto, opção, n.º da apólice (identifica o contrato), objeto seguro e capitais do verso (casa: objetos com valor seguro; automóvel: colunas com cabeçalho em duas linhas). A ata de renovação e as condições particulares não têm QR: lidas por `src/parsers/policy-documents.ts` (não são faturas; atualizam o contrato da apólice), testadas contra `fixtures/generali-docs/` |
| `indaqua` | 506925005, 501305912 | Indaqua Matosinhos: um PDF com duas faturas, cada uma com QR — Indaqua (água, saneamento, taxa de recursos hídricos; IVA 6 %) e Município de Matosinhos (resíduos, não sujeito a IVA, contrato "Resíduos"); faturação bimestral; linhas sem IVA, com escalão ("1º", "2º"), origem e preço unitário; leitura do contador em m³. Os valores estão alinhados à direita e o "³" é um item à parte, por isso os campos reconhecem-se pelo conteúdo e não pela coluna. As outras concessões da Indaqua só entram com faturas reais (NIF do QR) |
| `repsol` | 500246963 | Um PDF com resumo, uma página por fatura (luz, gás; um QR cada) e dados do contrato; linhas sem IVA; acertos de estimativas anteriores |
