# Faturómetro

PWA gratuita e local-first para acompanhar as faturas da casa em Portugal — eletricidade, gás, água, telecomunicações e seguros: deteta aumentos e fins de fidelização, e compara a eletricidade com as ofertas da ERSE.

**Experimentar online:** <https://app.faturometro.workers.dev> (no telemóvel: abre o endereço e instala como app).

## O que faz

- **Lê as faturas** em PDF ou fotografia: o código QR fiscal (total, IVA, data) em todas; o resto (período, linhas, consumos, contrato) com leitores automáticos por fornecedor. Uma fatura pode ter várias fotografias.
- **Valida** cada leitura contra o QR fiscal, venha de um leitor ou da IA.
- **Alertas:** aumentos de preço, fim de fidelização, fatura em falta, renovação de seguros, leituras estimadas, erros nas contas da fatura.
- **Contratos:** histórico, mensalidade contratada, periodicidade, coberturas e capitais dos seguros, "mudei de fornecedor".
- **Eletricidade:** comparação com as ofertas do simulador da ERSE.
- **Casa:** gastos por mês e por tipo de despesa.
- **Cartas** ao fornecedor, sem IA: pedir um preço melhor, contestar um aumento, reclamar de leituras estimadas, denunciar o contrato.
- **IA opcional** com a tua própria chave da Anthropic, para fornecedores sem leitor: mostra o que vai ser enviado e o custo antes de enviar.

### Fornecedores com leitor automático

| Tipo | Fornecedores |
|---|---|
| Eletricidade e gás | Repsol |
| Telecomunicações | NOS |
| Água | Indaqua Matosinhos (com resíduos do Município) |
| Seguros | Fidelidade (recibos e condições particulares de saúde), Generali (recibos, ata de renovação e condições particulares) |

Os outros fornecedores funcionam pelo QR fiscal (total, IVA e data), com o resto à mão ou pela IA. Na app, **"Contribuir com este layout"** envia ao responsável a estrutura anonimizada e cifrada de uma fatura sem leitor, para que se crie um — ver [`docs/parsers.md`](docs/parsers.md).

## Privacidade

- Os dados ficam no teu dispositivo. Sem cookies, estatísticas de utilização nem publicidade.
- **Sem conta:** experimentas logo, sem email; os dados ficam só nesse browser.
- **Com conta:** os dados ficam cifrados com a tua palavra-passe; a IA fica disponível.
- **Sincronização opcional** entre dispositivos (e dos PDF e fotografias originais) através de <https://sync.faturometro.workers.dev>, que só recebe dados cifrados no dispositivo — nunca os dados em claro nem a chave.

Sugestões e problemas: <faturometro@outlook.com> ou pelas *issues* deste repositório.

Estado: em desenvolvimento — ver [`planning/PLAN.md`](planning/PLAN.md).

## Experimentar

Requisitos: Node 24 e pnpm (`corepack enable pnpm`). Depois de clonar: `pnpm install`.

### No computador

```bash
pnpm dev                    # http://localhost:5173, recarrega ao editar
# ou, como em produção (com service worker e instalação como app):
pnpm build && pnpm preview  # http://localhost:4173
```

### No telemóvel

O browser só permite a cifra da conta e a instalação como app em páginas HTTPS, por isso o endereço da rede local (`http://192.168.x.x`) não serve. Usa um túnel HTTPS temporário da Cloudflare (gratuito, sem conta):

1. Instala uma vez o `cloudflared`: `winget install Cloudflare.cloudflared` (Windows).
2. Num terminal: `pnpm build && pnpm preview`.
3. Noutro terminal: `pnpm tunnel` e abre no telemóvel o endereço `https://….trycloudflare.com` que aparece.

O túnel só serve o código da app; as faturas ficam no browser do telemóvel. O endereço muda sempre que o túnel é reiniciado, e com ele a "origem" do site: uma conta criada num endereço não aparece noutro (a não ser pela sincronização).

### Verificações

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Regras do projeto (privacidade, fixtures, valores em cêntimos…) em [`CLAUDE.md`](CLAUDE.md); como escrever um leitor em [`docs/parsers.md`](docs/parsers.md).

## Publicar (Cloudflare)

Cada push para `main` corre as verificações no GitHub Actions e, se passarem, publica a app e o servidor de sincronização. Detalhes, endereços e recursos em [`planning/PLAN.md`, secção 15b](planning/PLAN.md). À mão:

```bash
pnpm exec wrangler login   # uma vez
pnpm deploy:app            # app estática
pnpm deploy:server         # servidor de sincronização (server/)
```

## Licença

© 2026 Paulo Barbosa. Código aberto sob a licença [GNU AGPL-3.0](LICENSE) (ou versão posterior): podes usar, estudar, alterar e partilhar o código; quem publicar uma versão alterada, mesmo só como site, tem de disponibilizar o respetivo código sob a mesma licença.
