# Faturómetro

PWA gratuita e local-first para acompanhar faturas domésticas portuguesas (telecomunicações, eletricidade, gás e água), detetar aumentos e fins de fidelização, e comparar a eletricidade com as ofertas da ERSE.

Os dados ficam no teu browser. A IA é opcional e usa a tua própria chave de API.

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

O túnel só serve o código da app; as faturas ficam no browser do telemóvel. Cada dispositivo tem a sua conta e os seus dados até existir a sincronização (Fase 4). O endereço muda sempre que o túnel é reiniciado, e com ele a "origem" do site: uma conta criada num endereço não aparece noutro.
