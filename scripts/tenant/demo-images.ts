// Generate placeholder images for a tenant folder: every image referenced in
// business.json that does not exist yet. Never overwrites existing files.
//   pnpm tenant:images <slug>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderLogo, renderScene } from '../lib/placeholder-images.ts';
import { tenantDir } from './load.ts';

export async function generateMissingImages(slug: string) {
  const dir = tenantDir(slug);
  const cfg = JSON.parse(readFileSync(path.join(dir, 'business.json'), 'utf8'));
  const accent = cfg.accent_color ?? '#4690FF';
  const created: string[] = [];
  const write = (rel: string, buf: Buffer) => {
    const p = path.join(dir, 'images', rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, buf);
    created.push(rel);
  };
  const missing = (rel?: string) => rel && !existsSync(path.join(dir, 'images', rel));
  if (missing(cfg.images?.logo)) write(cfg.images.logo, await renderLogo(cfg.name ?? slug, accent));
  if (missing(cfg.images?.hero)) write(cfg.images.hero, await renderScene({ width: 1600, height: 1000, accent, seed: 2, label: 'демо-фото' }));
  let i = 0;
  for (const g of cfg.gallery ?? []) {
    i += 1;
    if (missing(g.image)) write(g.image, await renderScene({ width: 1200, height: 900, accent, seed: i, hue: 200 + i * 23, label: 'демо-фото' }));
  }
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: pnpm tenant:images <slug>');
    process.exit(1);
  }
  const created = await generateMissingImages(slug);
  console.log(created.length ? `created: ${created.join(', ')}` : 'nothing to create');
}
