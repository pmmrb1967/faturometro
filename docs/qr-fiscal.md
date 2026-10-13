# QR fiscal — resumo da especificação da AT

Fonte: **"Especificações Técnicas — Código de Barras Bidimensional — Código QR", Portaria n.º 195/2020, versão 1.1, outubro de 2020**, Autoridade Tributária e Aduaneira.

- URL oficial (em 2026-10-13 devolve "File Not Found"): `https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/Novas_regras_faturacao/Documents/Especificacoes_Tecnicas_Codigo_QR.pdf`
- Cópia consultada: Internet Archive (`web.archive.org/web/2024id_/<URL oficial>`), 21 páginas, SHA-256 `e0f1fdd24623916ef573dcda9a99de4d3cb09e6396b2c2b01807af460bc552f2`.
- Base legal: Decreto-Lei n.º 28/2019 (art.º 4.º) e Portaria n.º 195/2020. As remissões a "SAF-T (PT)" referem-se à estrutura da Portaria n.º 321-A/2007.

Este documento resume só o que está na especificação. Valores que a especificação delega no SAF-T (PT) — lista completa de tipos e estados de documento — **não** estão aqui e têm de ser confirmados na documentação do SAF-T antes de serem usados.

## Onde aparece

- Obrigatório nas faturas e outros documentos fiscalmente relevantes emitidos por programas certificados.
- Em documentos com mais de uma página, pode estar **na primeira ou na última página** → a leitura deve tentar ambas (e, por robustez, todas).
- Características do símbolo: ECC "M", modo Byte, versão mínima 9, mínimo 30×30 mm, margem 0,25 cm.

## Composição da mensagem

1. Cada campo é `<código>:<valor>`, sem espaços.
2. Campos separados por `*`, **sempre pela ordem da tabela** abaixo.
3. Valores monetários em euros, `.` como separador decimal, **sempre duas casas decimais**, sem separador de milhares (ex.: `12000.00`). Documentos noutra moeda são convertidos para euros.
4. Campos `+` são obrigatórios; campos `++` são opcionais mas devem existir sempre que haja informação; campos opcionais sem informação **não** aparecem.
5. Espaços fiscais (`I1`, `J1`, `K1`): pelo menos um e no máximo três em simultâneo, nacionais ou estrangeiros.
6. Documento sem indicação da taxa de IVA (tabelas 4.2/4.3/4.4 do SAF-T): `I1:0`.
7. Nenhum valor pode exceder o tamanho máximo da tabela.
8. Campo `S`: elementos separados por `;`; não pode conter `*`.
9. Por taxa de IVA (isenta, reduzida, intermédia, normal) aparecem os totais acumulados de base tributável e de IVA.

## Campos

| Código | Descrição | Tam. máx. | Obrig. | Exemplo | Notas |
|---|---|---|---|---|---|
| A | NIF do emitente | 9 | + | `A:123456789` | Sem espaços nem prefixo de país (`TaxRegistrationNumber`) |
| B | NIF do adquirente | 30 | + | `B:999999990` | Sem prefixo de país (`CustomerTaxID`). Consumidor final: `999999990`. Pode ser estrangeiro (ex. 5: `B:4443332215`) |
| C | País do adquirente | 12 | + | `C:PT` | Campo `Country` do SAF-T |
| D | Tipo de documento | 2 | + | `D:FT` | `InvoiceType`, `MovementType`, `WorkType` ou `PaymentType` do SAF-T. Exemplos na especificação: `FT`, `FS`, `PF`, `GT`, `ND` |
| E | Estado do documento | 1 | + | `E:N` | `InvoiceStatus`, `MovementStatus`, `WorkStatus` ou `PaymentStatus` do SAF-T. Exemplos: só `N` |
| F | Data do documento | 8 | + | `F:20191231` | `YYYYMMDD` |
| G | Identificação única do documento | 60 | + | `G:FT AB2019/0035` | `InvoiceNo`, `DocumentNumber` ou `PaymentRefNo`. **Contém espaço** |
| H | ATCUD | 70 | + | `H:CSDF7T5H-0035` | |
| I1 | Espaço fiscal | 5 | + | `I1:PT` | `TaxCountryRegion` (ex.: `PT`, `PT-AC`, `PT-MA`, `FR`); `0` se sem taxa de IVA |
| I2 | Base tributável isenta de IVA | 16 | ++ | `I2:12000.00` | Inclui operações sujeitas a Imposto do Selo |
| I3 | Base tributável à taxa reduzida | 16 | ++ | `I3:15000.00` | |
| I4 | Total de IVA à taxa reduzida | 16 | ++ | `I4:900.00` | |
| I5 | Base tributável à taxa intermédia | 16 | ++ | `I5:50000.00` | |
| I6 | Total de IVA à taxa intermédia | 16 | ++ | `I6:6500.00` | |
| I7 | Base tributável à taxa normal | 16 | ++ | `I7:80000.00` | |
| I8 | Total de IVA à taxa normal | 16 | ++ | `I8:18400.00` | |
| J1–J8 | Idem para um 2.º espaço fiscal | 5 / 16 | ++ | `J1:PT-AC` | Mesma estrutura que I1–I8 |
| K1–K8 | Idem para um 3.º espaço fiscal | 5 / 16 | ++ | `K1:PT-MA` | Mesma estrutura que I1–I8 |
| L | Não sujeito / não tributável em IVA / outras situações | 16 | ++ | `L:100.00` | Ex.: regime da margem |
| M | Imposto do Selo | 16 | ++ | `M:25.00` | |
| N | Total de impostos | 16 | + | `N:64000.02` | IVA + Imposto do Selo (`TaxPayable`) |
| O | Total do documento com impostos | 16 | + | `O:513600.58` | `GrossTotal` |
| P | Retenções na fonte | 16 | ++ | `P:100.00` | `WithholdingTaxAmount` |
| Q | 4 carateres do hash | 4 | + | `Q:kLp0` | Portaria n.º 363/2010 |
| R | N.º do certificado do programa | 4 | + | `R:9999` | `SoftwareCertificateNumber` |
| S | Outras informações | 65 | ++ | `S:TB;PT00000000000000000000000;513500.58` | Livre; ex.: IBAN ou referência MB (`S:MB;entidade;referência;valor`), `S:NU;0.80` |

## Exemplos da especificação (para testes)

Mensagens copiadas da especificação (as quebras de linha do PDF foram removidas):

```text
# 5.1 Fatura (três espaços fiscais, IBAN)
A:123456789*B:999999990*C:PT*D:FT*E:N*F:20191231*G:FT AB2019/0035*H:CSDF7T5H-0035*I1:PT*I2:12000.00*I3:15000.00*I4:900.00*I5:50000.00*I6:6500.00*I7:80000.00*I8:18400.00*J1:PT-AC*J2:10000.00*J3:25000.56*J4:1000.02*J5:75000.00*J6:6750.00*J7:100000.00*J8:18000.00*K1:PT-MA*K2:5000.00*K3:12500.00*K4:625.00*K5:25000.00*K6:3000.00*K7:40000.00*K8:8800.00*L:100.00*M:25.00*N:64000.02*O:513600.58*P:100.00*Q:kLp0*R:9999*S:TB;PT00000000000000000000000;513500.58

# 5.2 Fatura simplificada
A:123456789*B:999999990*C:PT*D:FS*E:N*F:20190812*G:FS CDVF/12345*H:CDF7T5HD-12345*I1:PT*I7:0.65*I8:0.15*N:0.15*O:0.80*Q:YhGV*R:9999*S:NU;0.80

# 5.3 Fatura pró-forma
A:500000000*B:123456789*C:PT*D:PF*E:N*F:20190123*G:PF G2019CB/145789*H:HB6FT7RV-145789*I1:PT*I2:12345.34*I3:12532.65*I4:751.96*I5:52789.00*I6:6862.57*I7:32425.69*I8:7457.91*N:15072.44*O:125165.12*Q:r/fY*R:9999

# 5.4 Documento de transporte (sem valores)
A:500000000*B:123456789*C:PT*D:GT*E:N*F:20190720*G:GT G234CB/50987*H:GTVX4Y8B-50987*I1:0*N:0.00*O:0.00*Q:5uIg*R:9999

# 5.5 Fatura com taxa de imposto estrangeiro
A:123456789*B:4443332215*C:FR*D:FT*E:N*F:20190526*G:ABC BNH/4561*H:DK5ZJ2HN-4561*I1:FR*I7:100.00*I8:20.00*N:20.00*O:120.00*Q:YJRE*R:9999

# 5.6 Nota de débito retificativa de imposto
A:123456789*B:500000000*C:PT*D:ND*E:N*F:20190216*G:M1F KLG/6145*H:RQD8L6DG-6145*I1:PT-MA*I6:26.50*N:26.50*O:26.50*Q:h1rB*R:9999

# 5.7 Fatura com IVA — regime da margem
A:500000000*B:123456789*C:PT*D:FT*E:N*F:20191124*G:NF 19A/789145*H:JL9DS4TT-789145*I1:PT-AC*I7:50.00*I8:9.00*L:1000.00*N:9.00*O:1059.00*Q:d8/K*R:9999
```

Ambiguidades do PDF a ter em conta:
- No exemplo 5.1, `J7` aparece partido como `J7:1000 0` / `0.00`; reconstruído como `100000.00` (o valor da tabela de campos).
- Nos exemplos 5.6 e 5.7 o PDF mostra um espaço depois dos dois pontos (`G: M1F`, `H: RQD8L6DG`, `H: JL9DS4TT`), que contraria a regra 1. Acima foi removido. **O parser deve aceitar e remover espaços à volta dos valores**, porque programas reais podem ter o mesmo desvio.

## Implicações para o Faturómetro

- **Montantes:** `parseDotDecimalAmount` (`src/lib/money.ts`) converte para cêntimos inteiros. O parser deve aceitar só duas casas decimais, mas tolerar valores com mais ou menos casas, registando um aviso.
- **Validação cruzada (Etapa 5):** total = `O`; impostos = `N` (IVA + Imposto do Selo, não só IVA). Para o IVA isolado: soma de `I4+I6+I8`, `J4+J6+J8`, `K4+K6+K8`.
- **Consistência interna do QR:** `N` ≈ soma dos IVA + `M`; `O` ≈ soma das bases + `N` + `L` (com tolerância de arredondamento; atenção que `P`, retenções, não entra em `O`). A confirmar com faturas reais antes de transformar em regra.
- **Deduplicação:** chave secundária `A` + `G` (o `G` contém espaços; não normalizar para lá do `trim`).
- **Notas de crédito:** o plano assume `D = NC` com valores negativos, mas `NC` não aparece nos exemplos desta especificação — confirmar com o SAF-T e com faturas reais.
- **Ordem dos campos:** a especificação exige ordem fixa, mas o parser não deve depender dela (mapear por código).
- **Campo S:** pode trazer IBAN ou referência MB — dados pessoais/de pagamento; tratar como sensível na anonimização.
