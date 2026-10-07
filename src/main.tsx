import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import './index.css';
import { App } from './app/App';
import { registerServiceWorker } from './pwa/register';

// "/s/<slug>" without the trailing slash is outside the studio's PWA scope;
// normalise it before routing so the manifest and service worker apply.
if (/^\/s\/[^/]+$/.test(location.pathname)) {
  history.replaceState(history.state, '', `${location.pathname}/${location.search}${location.hash}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
