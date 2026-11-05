import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SCRIPT = readFileSync(new URL('../../public/boot-recover.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.faturometro.workers.dev';

type Listener = (event: { target: unknown }) => void;

/** Runs public/boot-recover.js in a fake page and returns what it touched. */
function page(options: { onLine?: boolean; stored?: string; now?: number } = {}) {
  const listeners: Listener[] = [];
  const items = new Map<string, string>();
  if (options.stored !== undefined) items.set('faturometro.boot-recover', options.stored);
  const unregister = vi.fn(async () => true);
  const deleted: string[] = [];
  const reload = vi.fn();
  const caches = {
    keys: async () => ['workbox-precache-v2-https://app/', 'shared-files', 'erse-data'],
    delete: async (key: string) => {
      deleted.push(key);
      return true;
    },
  };
  const window = {
    addEventListener: (type: string, listener: Listener, capture?: boolean) => {
      if (type === 'error' && capture) listeners.push(listener);
    },
    caches,
  };
  runInNewContext(SCRIPT, {
    window,
    caches,
    location: { href: `${ORIGIN}/app`, origin: ORIGIN, reload },
    navigator: {
      onLine: options.onLine ?? true,
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
    },
    sessionStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    },
    Date: { now: () => options.now ?? 1_000_000_000 },
    URL,
    Number,
    String,
    Promise,
  });
  const fail = (target: unknown) => {
    for (const listener of listeners) listener({ target });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { fail, settle, unregister, deleted, reload, items };
}

const oldScript = { tagName: 'SCRIPT', src: `${ORIGIN}/assets/index-R5hRIZjO.js` };

describe('boot-recover.js', () => {
  it('drops the stored app and reloads when one of its scripts fails', async () => {
    const view = page();
    view.fail(oldScript);
    await view.settle();
    expect(view.unregister).toHaveBeenCalledOnce();
    expect(view.deleted).toEqual(['workbox-precache-v2-https://app/']);
    expect(view.reload).toHaveBeenCalledOnce();
  });

  it('also recovers from a missing stylesheet, once for several failures', async () => {
    const view = page();
    view.fail({ tagName: 'LINK', href: `${ORIGIN}/assets/style-C_od3Gq7.css` });
    view.fail(oldScript);
    await view.settle();
    expect(view.reload).toHaveBeenCalledOnce();
  });

  it('ignores files of other sites and failed images', async () => {
    const view = page();
    view.fail({ tagName: 'SCRIPT', src: 'https://static.cloudflareinsights.com/beacon.min.js' });
    view.fail({ tagName: 'IMG', src: `${ORIGIN}/assets/logo.png` });
    await view.settle();
    expect(view.reload).not.toHaveBeenCalled();
  });

  it('does nothing offline, where a reload would lose the cached app', async () => {
    const view = page({ onLine: false });
    view.fail(oldScript);
    await view.settle();
    expect(view.unregister).not.toHaveBeenCalled();
    expect(view.reload).not.toHaveBeenCalled();
  });

  it('does not reload again within five minutes, so a failing version cannot loop', async () => {
    const now = 1_000_000_000;
    const recent = page({ stored: String(now - 60_000), now });
    recent.fail(oldScript);
    await recent.settle();
    expect(recent.reload).not.toHaveBeenCalled();

    const later = page({ stored: String(now - 6 * 60_000), now });
    later.fail(oldScript);
    await later.settle();
    expect(later.reload).toHaveBeenCalledOnce();
    expect(later.items.get('faturometro.boot-recover')).toBe(String(now));
  });
});
