/*
 * Recovery from a page of an earlier version (loaded by index.html before the
 * app, under a name that never changes). After a deploy, a browser can still
 * hold an old index.html whose scripts and styles no longer exist: the page
 * stays blank. When one of the app's own files (/assets/…) fails to load, this
 * removes the stored copy of the app (service worker and its precache) and
 * reloads, which brings the current version. The data (IndexedDB) and the
 * other caches (shared files, ERSE offers) are kept. Pages loaded later do the
 * same in src/app/lazy-page.ts. Plain script, no build step; tested in
 * src/app/boot-recover.test.ts.
 */
(function () {
  var KEY = 'faturometro.boot-recover';
  var RETRY_MS = 5 * 60 * 1000;
  var started = false;

  function isOwnAsset(url) {
    try {
      var parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname.indexOf('/assets/') === 0;
    } catch (error) {
      return false;
    }
  }

  function recover() {
    if (started) return;
    // Offline, a reload would show the browser's error page instead of the cached app.
    if (navigator.onLine === false) return;
    try {
      // At most once every few minutes: if the current version fails too, a reload loop helps nobody.
      var last = Number(sessionStorage.getItem(KEY));
      if (last && Date.now() - last < RETRY_MS) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (error) {
      return;
    }
    started = true;
    var jobs = [];
    if (navigator.serviceWorker) {
      jobs.push(
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
          return Promise.all(
            registrations.map(function (registration) {
              return registration.unregister();
            }),
          );
        }),
      );
    }
    if (window.caches) {
      jobs.push(
        caches.keys().then(function (keys) {
          return Promise.all(
            keys
              .filter(function (key) {
                return key.indexOf('workbox-precache') === 0;
              })
              .map(function (key) {
                return caches.delete(key);
              }),
          );
        }),
      );
    }
    Promise.all(jobs)
      .catch(function () {
        return undefined;
      })
      .then(function () {
        location.reload();
      });
  }

  // A script or style that fails to load: the event does not bubble, so listen while it descends.
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (!target || (target.tagName !== 'SCRIPT' && target.tagName !== 'LINK')) return;
      if (isOwnAsset(target.src || target.href || '')) recover();
    },
    true,
  );
})();
