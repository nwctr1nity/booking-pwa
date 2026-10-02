// Post-build step: one static shell per studio under dist/s/<slug>/ with its
// own HTML metadata, Web App Manifest (id/start_url/scope = /s/<slug>/),
// icons, maskable icon, apple-touch-icon, iOS startup images and a copy of
// the service worker (separate scope → separate caches). The JS/CSS bundle
// is shared by all studios. Also writes Cloudflare Pages _redirects/_headers.
//
// Studio name, short name, accent and logo come from the database (the
// runtime source, so owner edits are reflected on the next build) when
// VITE_SUPABASE_URL is reachable, otherwise from tenants/<slug>/business.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getEnv, keyHeaders, siteEnv } from '../lib/env.ts';
import { listTenantSlugs, validateTenant } from '../tenant/load.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(ROOT, 'dist');

export interface ShellInfo {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  logo: Buffer;
  source: 'database' | 'config';
  /** the database says the studio is a demo (preview): not for search engines */
  preview?: boolean;
}

// Portrait iPhone/iPad startup images: [css width, css height, dpr].
const STARTUP = [
  [375, 667, 2], [414, 896, 2], [375, 812, 3], [414, 896, 3], [390, 844, 3], [393, 852, 3], [428, 926, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3],
  [768, 1024, 2], [834, 1194, 2], [1024, 1366, 2],
] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fromDatabase(slug: string): Promise<Partial<ShellInfo> | null> {
  const { url, key } = await siteEnv();
  if (!url || !key || getEnv('SHELL_SOURCE') === 'config') return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/public_get_studio`, {
      method: 'POST',
      headers: keyHeaders(key, { 'content-type': 'application/json' }),
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(8000),
    });
    const s = await r.json();
    if (!r.ok || s?.error) return null;
    let logo: Buffer | undefined;
    if (s.logo_path) {
      const img = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/public/tenant-media/${s.logo_path}`, { signal: AbortSignal.timeout(8000) });
      if (img.ok) logo = Buffer.from(await img.arrayBuffer());
    }
    return { name: s.name, shortName: s.short_name, description: s.tagline || s.description, accent: s.accent_color, logo, source: 'database', preview: s.status === 'preview' };
  } catch {
    return null;
  }
}

async function shellInfo(slug: string): Promise<ShellInfo> {
  const v = await validateTenant(slug);
  if (!v.tenant) throw new Error(`${slug}: ${v.errors.join('; ')}`);
  const c = v.tenant.config;
  const base: ShellInfo = {
    slug,
    name: c.name,
    shortName: c.short_name,
    description: c.tagline || c.description.slice(0, 160),
    accent: c.accent_color,
    logo: readFileSync(path.join(v.tenant.dir, 'images', c.images.logo)),
    source: 'config',
  };
  const db = await fromDatabase(slug);
  if (!db) return base;
  return { ...base, ...Object.fromEntries(Object.entries(db).filter(([, val]) => val !== undefined && val !== '')) } as ShellInfo;
}

async function icon(logo: Buffer, size: number, opts: { padding?: number; background?: string } = {}) {
  const pad = Math.round(size * (opts.padding ?? 0));
  const inner = size - pad * 2;
  const img = await sharp(logo).resize(inner, inner, { fit: 'contain', background: opts.background ?? '#000000' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: opts.background ?? '#000000' } })
    .composite([{ input: img, left: pad, top: pad }])
    .png()
    .toBuffer();
}

async function startupImage(logo: Buffer, w: number, h: number) {
  const s = Math.round(Math.min(w, h) * 0.28);
  const img = await sharp(logo).resize(s, s, { fit: 'contain', background: '#000000' }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } })
    .composite([{ input: img, left: Math.round((w - s) / 2), top: Math.round((h - s) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function manifestFor(info: ShellInfo) {
  const scope = `/s/${info.slug}/`;
  return {
    id: scope,
    name: info.name,
    short_name: info.shortName,
    description: info.description,
    lang: 'ru',
    dir: 'ltr',
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['business', 'lifestyle'],
    icons: [
      { src: `${scope}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${scope}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${scope}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Записаться', url: `${scope}?book=service` },
      { name: 'Моя запись', url: `${scope}my` },
    ],
  };
}

export function headFor(info: ShellInfo) {
  const scope = `/s/${info.slug}/`;
  const title = `${info.name} — онлайн-запись`;
  const startup = STARTUP.map(
    ([w, h, d]) =>
      `<link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait)" href="${scope}startup-${w * d}x${h * d}.png" />`,
  );
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(info.description)}" />`,
    `<link rel="manifest" href="${scope}manifest.webmanifest" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${scope}favicon-32.png" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${scope}apple-touch-icon.png" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(info.shortName)}" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(info.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="studio-slug" content="${esc(info.slug)}" />`,
    ...(info.preview ? ['<meta name="robots" content="noindex, nofollow" />'] : []),
    ...startup,
  ].join('\n    ');
}

export async function writeShell(info: ShellInfo, template: string, swSource: string) {
  const dir = path.join(DIST, 's', info.slug);
  mkdirSync(dir, { recursive: true });
  const html = template.replace(/<!--tenant-head:start-->[\s\S]*<!--tenant-head:end-->/, headFor(info));
  if (html === template) throw new Error('index.html has no tenant-head markers');
  writeFileSync(path.join(dir, 'index.html'), html);
  writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify(manifestFor(info), null, 2));
  copyFileSync(swSource, path.join(dir, 'sw.js'));
  const files: [string, Promise<Buffer>][] = [
    ['icon-192.png', icon(info.logo, 192)],
    ['icon-512.png', icon(info.logo, 512)],
    ['icon-maskable-512.png', icon(info.logo, 512, { padding: 0.12 })],
    ['apple-touch-icon.png', icon(info.logo, 180)],
    ['favicon-32.png', icon(info.logo, 32)],
    ...STARTUP.map(([w, h, d]) => [`startup-${w * d}x${h * d}.png`, startupImage(info.logo, w * d, h * d)] as [string, Promise<Buffer>]),
  ];
  for (const [name, buf] of files) writeFileSync(path.join(dir, name), await buf);
}

// One CSP for every host: sent as a <meta> tag in each HTML shell (works on
// Vercel, Cloudflare Pages or any static host) and, where the host supports
// header files, also as a header. frame-ancestors is header-only, so the
// meta variant relies on X-Frame-Options from vercel.json / _headers.
export function contentSecurityPolicy(supabaseUrl: string | undefined, forMeta = false) {
  const origin = supabaseUrl ? new URL(supabaseUrl).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Astryx injects theme CSS at runtime
    `img-src 'self' data: blob: ${origin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${origin}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(forMeta ? [] : ["frame-ancestors 'none'"]),
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function withCspMeta(html: string, supabaseUrl: string | undefined) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(supabaseUrl, true)}" />`;
  return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?\s*/, '').replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tag}`);
}

// Cloudflare Pages header/redirect files. Vercel uses vercel.json instead and
// ignores these.
function cloudflareFiles(supabaseUrl: string | undefined) {
  const csp = contentSecurityPolicy(supabaseUrl);
  // Cloudflare Pages applies _redirects even when a static file matches, so a
  // catch-all /s/:slug/* would hijack sw.js and the manifest. Instead every
  // client route is listed explicitly and rewritten (200) to that studio's
  // own shell, so a deep link opens with the right manifest and SW scope.
  writeFileSync(
    path.join(DIST, '_redirects'),
    ['/s/:slug/services /s/:slug/ 200', '/s/:slug/my /s/:slug/ 200', '/s/:slug/owner /s/:slug/ 200', '/s/:slug/owner/* /s/:slug/ 200', ''].join('\n'),
  );
  writeFileSync(
    path.join(DIST, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  X-Frame-Options: DENY',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
      `  Content-Security-Policy: ${csp}`,
      '/assets/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '/s/*/sw.js',
      '  Cache-Control: no-cache',
      '/s/*/index.html',
      '  Cache-Control: no-cache',
      '/s/*/manifest.webmanifest',
      '  Cache-Control: no-cache',
      '  Content-Type: application/manifest+json',
      '',
    ].join('\n'),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await siteEnv();
  if (!site.url) throw new Error('VITE_SUPABASE_URL is not set (.env.production or environment)');
  const template = withCspMeta(readFileSync(path.join(DIST, 'index.html'), 'utf8'), site.url);
  writeFileSync(path.join(DIST, 'index.html'), template);
  const sw = path.join(DIST, 'sw.js');
  if (!existsSync(sw)) throw new Error('dist/sw.js missing: run vite build first');
  for (const slug of listTenantSlugs()) {
    const info = await shellInfo(slug);
    await writeShell(info, template, sw);
    console.log(`shell /s/${slug}/ (${info.source})`);
  }
  cloudflareFiles(site.url);
  // Vercel serves 404.html for paths with no file: an unknown or not yet
  // rebuilt studio still gets the app (which shows "studio not found" or
  // loads the studio from the database) instead of a bare host error page.
  writeFileSync(path.join(DIST, '404.html'), template);
}
