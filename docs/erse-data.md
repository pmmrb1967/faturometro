# Dados de ofertas da ERSE — fonte, formato e condições

Consultado em 2026-10-13.

## Fonte

- Simulador: <https://simuladorprecos.erse.pt/> — compara as ofertas de eletricidade (BTN) e gás natural (BP) em Portugal continental.
- O link "Ofertas comerciais (CSV) — Atualizado em DD-MM-AAAA" da página inicial é preenchido por JavaScript a partir de **`https://simuladorprecos.erse.pt/config/Settings.json`**, campo **`csvPath`**.
  - Exemplo em 2026-10-13: `https://simuladorprecos.erse.pt/Admin/csvs/20261013 122404 CSV.zip` (o nome muda a cada atualização; codificar os espaços no URL).
  - `scripts/erse-sync.ts` deve ler `Settings.json` → `csvPath`, e não fixar o nome do ficheiro.
- Metadados oficiais (descrição dos campos): <https://www.erse.pt/media/mr4puo2e/metadata.xlsx>, ligado em <https://www.erse.pt/simuladores/precos-de-energia/>.
- Documentos de apoio na mesma página, úteis mais tarde (não lidos ainda):
  - IVA na fatura de eletricidade: `https://www.erse.pt/media/tcsfm4n2/ersexplica_iva-fatura_2025.pdf`
  - Períodos horários: `https://www.erse.pt/media/wijn0vgt/periodos-horários-de-energia-elétrica-em-portugal.pdf`

## Frequência de atualização

O ficheiro tem a data e hora no nome e a página indica "Atualizado em". Não foi encontrada uma periodicidade oficial. A sync semanal prevista no plano é suficiente; o script deve guardar a data do ficheiro (do nome ou do texto "Atualizado em") e a app mostrá-la.

## Condições de reutilização

As perguntas e respostas do simulador (`https://simuladorprecos.erse.pt/content/files/SimuladorERSE.pdf`) dizem:

> "De forma a permitir a terceiros tratar a informação das ofertas de mercado com ferramentas de análise, disponibiliza-se ainda na página inicial do simulador toda a informação num formato de base de dados (formato CSV)."

**Não foi encontrada uma licença formal** (ex.: CC-BY). Decisão a confirmar: citar sempre a fonte ("Fonte: ERSE — Simulador de preços, dados de AAAA-MM-DD"), não alterar os preços e remeter para a ficha padronizada do comercializador. Se for preciso certeza jurídica, pedir confirmação à ERSE.

## Formato

ZIP com duas tabelas, **UTF-8 com BOM, separador `;`, fins de linha CRLF, vírgula decimal**. No ZIP, os caminhos usam `\` (`csv\CondComerciais.csv`); o script deve normalizar.

Em 2026-10-13: 896 ofertas (`CondComerciais.csv`), 16 891 linhas de preços (`Precos_ELEGN.csv`), 37 códigos de comercializador.

### `Precos_ELEGN.csv` — preços

Chave de junção com as condições: `COD_Proposta`.

| Coluna | Descrição (metadados) | Observado |
|---|---|---|
| `COM` | Comercializador | Código curto (ex.: `TUR`, `ALFAENERGIA`) |
| `Pot_Cont` | Potência contratada | kVA com vírgula: `1,15` … `41,4` |
| `Escalao` | Escalão de consumo (gás) | `1`–`4` ou vazio |
| `ORD` | Operador de rede (gás) | ex.: `LIS`, `SET`, … ou vazio |
| `COD_Proposta` | Código da oferta | |
| `Contagem` | Ciclo de contagem | `1`, `2`, `3` ou vazio; ver nota abaixo |
| `TF` | Termo fixo (€/dia) | |
| `TV\|TVFV\|TVP` | Termo de energia (€/kWh) — Simples \| Fora de Vazio \| Ponta | Coluna depende do ciclo |
| `TVV\|TVC` | Termo de energia (€/kWh) — Vazio \| Cheias | |
| `TVVz` | Termo de energia (€/kWh) — Vazio | Tri-horário |
| `TFGN` | Termo fixo (€/dia) — gás natural | |
| `TVGN` | Termo de energia (€/kWh) — gás natural | |

Nota: os metadados descrevem `TipoContagem` (nas condições) como 1 = Simples, 2 = Bi-horária, 3 = Tri-horária. **Assume-se** que `Contagem` nos preços usa os mesmos códigos; é consistente com os dados (a `TUR` com `Contagem = 2` preenche `TV|TVFV|TVP` e `TVV|TVC`), mas falta confirmação explícita.

Preços com muitas casas decimais (ex.: `0,261579822840437`): guardar como string decimal ou número com precisão suficiente; só o resultado final do cálculo passa a cêntimos (`src/lib/money.ts`).

### `CondComerciais.csv` — condições

Colunas principais (lista completa no `metadata.xlsx`):

| Coluna | Descrição | Valores |
|---|---|---|
| `COM`, `COD_Proposta`, `NomeProposta` | Identificação | |
| `Segmento` | Segmento | `Dom`, `Ndom`, `Tod` |
| `TipoContagem` | Ciclos com oferta | Dígitos combinados: `12` = simples e bi-horária, `123` = os três |
| `Fornecimento` | Tipo de energia | `ELE`, `GN`, `DUAL` |
| `DuracaoContrato` | Duração (meses) | |
| `Data ini`, `Data fim` | Validade da oferta | `DD/MM/AAAA` |
| `FiltroContratacao` | Eletrónica \| Presencial \| Telefónica | Máscara de bits, ex.: `110` |
| `Filtrofaturacao` | Eletrónica \| Papel | ex.: `10` |
| `FiltroPagamento` | Débito direto \| Multibanco \| Numerário/Payshop/CTT | ex.: `100` |
| `FiltroAtendimento` | Escrito \| Presencial \| Telefónico \| Eletrónico | ex.: `1001` |
| `FiltroFidelização`, `FiltroRenovavel_ELE`, `FiltroRestrições`, `FiltroPrecosIndex_ELE`, `FiltroServicosAdic`, `FiltroTarifaSocial`, `FiltroReembolsos`, `FiltroNovosClientes` | Sim/Não | `S` / `N` |
| `CustoServicos_s/IVA (€/ano)`, `CustoServicos_c/IVA (€/ano)` | Serviços adicionais obrigatórios | |
| `ReembFixo (€/ano)`, `ReembTF_ELE (%)`, `ReembTW_ELE (%)`, `ReembW_ELE (€/kWh)`, … | Descontos para todos os clientes | |
| `DescontNovoCliente_c/IVA (€/ano)`, `Desc. TF_ELE (%) - Novo Cliente`, … | Descontos só para novos clientes | |
| `TxTOferta`, `TxTERSE`, `TxTFidelização`, `TxTAtualizaPrecos`, … | Textos descritivos | |
| `LinkCOM`, `LinkOfertaCom`, `LinkFichaPadrao`, `LinkCondicoesGerais` | Links | |

Diferenças entre os metadados e o CSV real (o script deve usar os nomes do CSV e validar o cabeçalho com zod):
- `CODProposta` (metadados) → `COD_Proposta` (CSV)
- `FiltroRenovavel` → `FiltroRenovavel_ELE`
- `FiltroPrecosIndex` → `FiltroPrecosIndex_ELE`
- `DetalheOutrosDesc/ben` → `DetalheOutrosDesc/benefi`

Valores vazios aparecem como campo vazio, espaço (`" "`) ou `-`.

## Questões em aberto

- **Os preços (`TF`, `TV…`) incluem IVA e taxas?** Os metadados não dizem. Os custos de serviços têm colunas separadas com e sem IVA, o que sugere que os termos não incluem IVA, mas isto **tem de ser confirmado** (documentação da ERSE ou cálculo contra faturas reais na Fase 3) antes de implementar o comparador.
- Confirmação explícita do significado de `Contagem` nos preços.
- Licença formal de reutilização.
