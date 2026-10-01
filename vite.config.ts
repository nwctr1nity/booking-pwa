import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // injectManifest: our own worker (src/sw.ts) gets the list of hashed
    // assets. Manifests, icons and per-studio shells are generated after the
    // build by scripts/build/tenant-shells.ts, one set per studio scope.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['assets/**/*.{js,css,woff2}'],
        rollupFormat: 'iife',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The worker lives at /s/<slug>/sw.js; assets are at the site root.
        modifyURLPrefix: { 'assets/': '/assets/' },
      },
      devOptions: { enabled: false },
    }),
  ],
  // supabase-js is only imported by the lazy owner chunk; pre-bundle it so the
  // dev server does not reload the page when the cabinet is first opened.
  optimizeDeps: { include: ['@supabase/supabase-js'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: an app update re-downloads only app code.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'astryx', test: /node_modules[\\/]@astryxdesign[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
});
