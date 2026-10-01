// Registers the service worker of the current studio scope (/s/<slug>/).
// Each studio has its own worker scope and cache names; see src/sw.ts.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const m = /^\/s\/([^/]+)\//.exec(location.pathname);
  if (!m) return;
  const scope = `/s/${m[1]}/`;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${scope}sw.js`, { scope, type: 'module' }).catch(() => {
      /* offline install is optional; the app works without it */
    });
  });
}
