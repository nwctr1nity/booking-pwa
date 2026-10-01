// Serve dist/ the way Cloudflare Pages does, for local verification:
// _redirects rules (with :placeholders and * splats) are applied first,
// then static files (directory → index.html), then the SPA fallback to
// /index.html. _headers rules are applied to the response.
//   pnpm local:serve   (http://127.0.0.1:4173)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../../dist');
const PORT = Number(process.env.PORT ?? 4173);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function pattern(src: string) {
  const re = src.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, '(?<$1>[^/]+)').replace(/\*/g, '(?<splat>.*)');
  return new RegExp(`^${re}$`);
}
const read = (f: string) => (existsSync(path.join(DIST, f)) ? readFileSync(path.join(DIST, f), 'utf8') : '');
const redirects = read('_redirects').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && !p[0]!.startsWith('#'))
  .map(([from, to, code]) => ({ re: pattern(from!), to: to!, code: Number(code ?? 302) }));
const headerRules: { re: RegExp; headers: [string, string][] }[] = [];
for (const line of read('_headers').split('\n')) {
  if (!line.trim()) continue;
  if (!/^\s/.test(line)) headerRules.push({ re: pattern(line.trim()), headers: [] });
  else { const i = line.indexOf(':'); headerRules.at(-1)!.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
}

function file(p: string) {
  const f = path.join(DIST, decodeURIComponent(p));
  if (!f.startsWith(DIST) || !existsSync(f)) return null;
  if (statSync(f).isDirectory()) return existsSync(path.join(f, 'index.html')) ? path.join(f, 'index.html') : null;
  return f;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = url.pathname;
  for (const r of redirects) {
    const m = r.re.exec(p);
    if (!m) continue;
    const to = r.to.replace(/:(\w+)/g, (_, k) => m.groups?.[k] ?? '').replace(':splat', m.groups?.splat ?? '');
    if (r.code === 200) { p = to; break; }
    res.writeHead(r.code, { location: to }).end();
    return;
  }
  const f = file(p) ?? file('/index.html')!;
  const status = file(p) || !path.extname(p) ? 200 : 404;
  const headers: Record<string, string> = { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' };
  for (const h of headerRules) if (h.re.test(url.pathname) || h.re.test(p)) for (const [k, v] of h.headers) headers[k] = v;
  if (status === 404) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, headers).end(readFileSync(f));
}).listen(PORT, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${PORT}`));
