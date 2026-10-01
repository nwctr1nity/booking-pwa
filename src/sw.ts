/// <reference lib="webworker" />
// One worker source, copied into every studio scope (/s/<slug>/sw.js).
// Cache names are derived from the scope, so studios never share or evict
// each other's caches. Only public assets are cached: API calls (/rest/,
// /auth/, /functions/) always go to the network and are never stored.
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const scope = new URL(self.registration.scope).pathname; // "/s/<slug>/"
const slug = decodeURIComponent(scope.split('/')[2] ?? 'root');
const prefix = `studio-${slug}`;
setCacheNameDetails({ prefix, suffix: 'v1', precache: 'assets', runtime: 'runtime' });

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Hashed JS/CSS/fonts shared by all studios, cached per scope.
precacheAndRoute(self.__WB_MANIFEST);

// Studio shell (HTML, manifest, icons): network first, cached copy offline.
const SHELL = `${prefix}-shell-v1`;
// The directory URL, not index.html: Pages redirects /index.html to /.
const shellUrl = scope;
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([shellUrl, `${scope}manifest.webmanifest`]).catch(() => undefined)),
  );
});

registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          const c = await caches.open(SHELL);
          await c.put(shellUrl, res.clone());
        }
        return res;
      } catch {
        return (await caches.match(shellUrl, { cacheName: SHELL })) ?? Response.error();
      }
    },
    { allowlist: [new RegExp(`^${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)] },
  ),
);

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith(scope) && /\.(png|webmanifest|svg)$/.test(url.pathname),
  new NetworkFirst({ cacheName: SHELL }),
);

// Public studio photos from Supabase Storage (public bucket, no personal data).
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.pathname.includes('/storage/v1/object/public/'),
  new CacheFirst({
    cacheName: `${prefix}-media-v1`,
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true })],
  }),
);

self.addEventListener('activate', (event) => {
  // Drop old caches of THIS studio only.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(`${prefix}-`) && !k.endsWith('-v1')).map((k) => caches.delete(k))),
    ),
  );
});

// ---- Web Push: reminder one day before the visit ----
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Напоминание о записи', {
      body: data.body ?? '',
      tag: data.tag,
      icon: `${scope}icon-192.png`,
      badge: `${scope}icon-192.png`,
      data: { url: data.url && data.url.startsWith(scope) ? data.url : `${scope}my` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? `${scope}my`, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin + scope) && 'focus' in c) {
          void (c as WindowClient).navigate(target);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
