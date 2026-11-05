/**
 * The app's Worker (wrangler.app.toml). Cloudflare serves every file in dist/
 * by itself and answers page navigations with index.html (single-page
 * application). Only the other requests that match no file reach this code:
 * a script, style or data file that no longer exists, usually one asked for by
 * a page from an earlier version. Those get a 404 instead of index.html, which
 * the browser would refuse as a script or style and leave the page blank
 * (public/boot-recover.js then reloads the current version).
 */

export interface AppEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/**
 * Whether the request wants a page although Cloudflare did not see a browser
 * navigation: a page asked for as HTML, or a client that is not a browser
 * (link previews, crawlers: no Sec-Fetch-Mode, often Accept: *\/*). Browsers
 * send Sec-Fetch-Mode with every script and style, so those still get a 404.
 */
function wantsPage(request: Request, url: URL): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/data/')) return false;
  if (!request.headers.has('Sec-Fetch-Mode')) return true;
  return (request.headers.get('Accept') ?? '').includes('text/html');
}

export async function handleAppRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  if (wantsPage(request, url)) {
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  }
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  fetch: handleAppRequest,
};
