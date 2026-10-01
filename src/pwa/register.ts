// Registers the service worker of the current studio scope (/s/<slug>/).
// Each studio has its own worker scope and cache names; see src/sw.ts.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const m = /^\/s\/([^/]+)\//.exec(location.pathname);
  if (!m) return;
  const scope = `/s/${m[1]}/`;
  const register = () =>
    navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => {
      /* offline install is optional; the app works without it */
    });
  // The module graph can finish evaluating after `load` has already fired.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
