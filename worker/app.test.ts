import { describe, expect, it, vi } from 'vitest';
import { handleAppRequest, type AppEnv } from './app';

const ORIGIN = 'https://app.faturometro.workers.dev';

function env() {
  const fetch = vi.fn(
    async (request: Request) => new Response(`index for ${new URL(request.url).pathname}`),
  );
  const appEnv: AppEnv = { ASSETS: { fetch } };
  return { appEnv, fetch };
}

describe('handleAppRequest', () => {
  it('answers a missing script of an earlier version with a 404, not the page', async () => {
    const { appEnv, fetch } = env();
    const response = await handleAppRequest(
      new Request(`${ORIGIN}/assets/index-R5hRIZjO.js`, {
        headers: { Accept: '*/*', 'Sec-Fetch-Mode': 'cors' },
      }),
      appEnv,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gives a 404 under /assets/ and /data/ even when HTML is accepted', async () => {
    const { appEnv } = env();
    for (const path of ['/assets/style-C_od3Gq7.css', '/data/erse-offers-v0.json']) {
      const response = await handleAppRequest(
        new Request(`${ORIGIN}${path}`, { headers: { Accept: 'text/html,*/*' } }),
        appEnv,
      );
      expect(response.status).toBe(404);
    }
  });

  it('serves index.html to a page request the browser did not mark as a navigation', async () => {
    const { appEnv, fetch } = env();
    const response = await handleAppRequest(
      new Request(`${ORIGIN}/app/faturas`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      }),
      appEnv,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('index for /index.html');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('serves index.html to link previews and crawlers, which are not browsers', async () => {
    const { appEnv } = env();
    for (const path of ['/', '/app']) {
      const response = await handleAppRequest(
        new Request(`${ORIGIN}${path}`, {
          headers: { Accept: '*/*', 'User-Agent': 'WhatsApp/2.23' },
        }),
        appEnv,
      );
      expect(response.status).toBe(200);
    }
  });

  it('gives a 404 to other missing files and to writes', async () => {
    const { appEnv } = env();
    const image = await handleAppRequest(
      new Request(`${ORIGIN}/old-icon.png`, {
        headers: { Accept: 'image/*', 'Sec-Fetch-Mode': 'no-cors' },
      }),
      appEnv,
    );
    const post = await handleAppRequest(
      new Request(`${ORIGIN}/app/x`, { method: 'POST', headers: { Accept: 'text/html' } }),
      appEnv,
    );
    expect(image.status).toBe(404);
    expect(post.status).toBe(404);
  });
});
