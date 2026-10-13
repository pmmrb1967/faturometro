/*
 * Web Share Target (imported by the service worker): "Share → Faturómetro"
 * from another app POSTs the files here. They are kept in this browser's
 * Cache Storage only until the app reads them (src/app/shared-files.ts),
 * then deleted. Nothing is sent anywhere.
 */
const SHARE_PATH = '/app/partilhar';
const SHARE_CACHE = 'shared-files';
const MAX_FILES = 10;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== SHARE_PATH) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form
          .getAll('file')
          .filter((file) => typeof file === 'object' && file !== null && 'arrayBuffer' in file)
          .slice(0, MAX_FILES);
        const cache = await caches.open(SHARE_CACHE);
        const stamp = Date.now();
        await Promise.all(
          files.map((file, index) =>
            cache.put(
              `/shared/${stamp}-${index}`,
              new Response(file, {
                headers: {
                  'Content-Type': file.type || 'application/octet-stream',
                  'X-File-Name': encodeURIComponent(file.name || ''),
                },
              }),
            ),
          ),
        );
      } catch {
        // A broken share just opens the invoices page.
      }
      return Response.redirect('/app/faturas', 303);
    })(),
  );
});
