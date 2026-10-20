/**
 * Cloudflare Web Analytics (no cookies), only on the published site's public
 * pages without a password field: never inside /app, where the user's data
 * lives. Leaving those pages within the app reloads the document, so the
 * beacon never stays around on the login page or inside the app (reloading
 * keeps the session, session-store.ts).
 */
import { BEACON_SCRIPT_ORIGIN, WEB_ANALYTICS_TOKEN } from './web-analytics-config';

const PUBLISHED_HOST = 'app.faturometro.workers.dev';
const TRACKED_PATHS = new Set(['/', '/privacidade']);

interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
}

/** The part of the app's router used here. */
interface Router {
  subscribe(listener: (state: { location: RouterLocation }) => void): () => void;
}

export function shouldLoadWebAnalytics(hostname: string, pathname: string): boolean {
  return Boolean(WEB_ANALYTICS_TOKEN) && hostname === PUBLISHED_HOST && TRACKED_PATHS.has(pathname);
}

export function loadWebAnalytics(router: Router): void {
  if (!shouldLoadWebAnalytics(location.hostname, location.pathname)) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = `${BEACON_SCRIPT_ORIGIN}/beacon.min.js`;
  script.dataset.cfBeacon = JSON.stringify({ token: WEB_ANALYTICS_TOKEN, spa: false });
  document.body.appendChild(script);

  router.subscribe(({ location: next }) => {
    if (TRACKED_PATHS.has(next.pathname)) return;
    window.location.replace(next.pathname + next.search + next.hash);
  });
}
