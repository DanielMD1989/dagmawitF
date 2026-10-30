/*
 * DAGMAWIT service worker, version 2 (docs/harden.md, "My Day without signal").
 *
 * What it does:
 *  - Makes the app installable on a phone's home screen.
 *  - Keeps the offline page (/offline) and exactly the files it needs (its scripts, styles and fonts under
 *    /_next/static/). My Day asks it to refresh them, so they follow each new version of the app.
 *  - When a page cannot be reached, or does not answer within 8 seconds, sends her to the offline page, which shows
 *    the day she last saw (kept by the page itself, in the browser's storage, not here).
 *  - Falls back to the plain /offline.html if the offline page was never kept.
 *
 * What it deliberately does not do: keep pages, data or anything from Supabase. Nothing of hers is in its caches.
 *
 * To change this file, bump VERSION so old caches are cleared.
 */
const VERSION = 'v3';
const SHELL = `dagmawit-shell-${VERSION}`;
const PLAIN_OFFLINE = '/offline.html';
const OFFLINE = '/offline';
const NAVIGATION_TIMEOUT_MS = 8000;
const REFRESH_EVERY_MS = 30 * 60 * 1000;
let refreshedAt = 0;

/** The files a page needs from /_next/static/: in its HTML, and the fonts its styles name. */
function staticFiles(text) {
  return [...new Set(text.match(/\/_next\/static\/[^"'()\s\\]+/g) ?? [])];
}

/** Keeps the offline page and what it needs, and drops what the previous copy needed and this one does not. */
async function keepOfflinePage() {
  const response = await fetch(OFFLINE, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || response.redirected) return;
  const html = await response.clone().text();
  const cache = await caches.open(SHELL);
  const wanted = new Set([PLAIN_OFFLINE, OFFLINE, '/icons/icon-192.png']);
  const pathOf = (path) => new URL(path, self.location.origin).pathname;
  for (const path of staticFiles(html)) {
    wanted.add(pathOf(path));
    let file = await cache.match(path);
    if (!file) {
      file = await fetch(path);
      if (!file.ok) return; // keep the copy we had: it is whole
      await cache.put(path, file.clone());
    }
    if (path.endsWith('.css')) {
      for (const font of staticFiles(await file.text())) {
        wanted.add(pathOf(font));
        if (!(await cache.match(font))) {
          const f = await fetch(font);
          if (f.ok) await cache.put(font, f);
        }
      }
    }
  }
  await cache.put(OFFLINE, response);
  for (const request of await cache.keys()) {
    if (!wanted.has(new URL(request.url).pathname)) await cache.delete(request);
  }
  refreshedAt = Date.now();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([PLAIN_OFFLINE, '/icons/icon-192.png']))
      .then(() => keepOfflinePage().catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('dagmawit-') && k !== SHELL).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// My Day says "refresh" each time it opens with signal; at most every half hour, or when nothing is kept yet.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'refresh-offline') return;
  event.waitUntil(
    caches.match(OFFLINE, { cacheName: SHELL }).then((kept) => {
      if (kept && Date.now() - refreshedAt < REFRESH_EVERY_MS) return undefined;
      return keepOfflinePage().catch(() => undefined);
    }),
  );
});

async function offlineAnswer(from) {
  if (await caches.match(OFFLINE, { cacheName: SHELL })) {
    return Response.redirect(`${OFFLINE}?from=${encodeURIComponent(from)}`, 302);
  }
  return (await caches.match(PLAIN_OFFLINE, { cacheName: SHELL })) ?? Response.error();
}

/** The network, unless there is none or it takes too long. */
function pageOrOffline(request, from) {
  return new Promise((resolve) => {
    let settled = false;
    const offline = () => {
      if (settled) return;
      settled = true;
      resolve(offlineAnswer(from));
    };
    const timer = setTimeout(offline, NAVIGATION_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(response);
        }
      },
      () => {
        clearTimeout(timer);
        offline();
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // The offline page is kept on purpose: use the kept copy first, so it opens at once with no signal.
    if (url.pathname === OFFLINE) {
      event.respondWith(caches.match(OFFLINE, { cacheName: SHELL }).then((kept) => kept ?? fetch(request)));
      return;
    }
    event.respondWith(pageOrOffline(request, url.pathname + url.search));
    return;
  }

  // The offline page's own files, when kept; everything else from the network as usual.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches
        .match(url.pathname, { cacheName: SHELL, ignoreSearch: true })
        .then((kept) => kept ?? fetch(request)),
    );
  }
});
