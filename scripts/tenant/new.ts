// pnpm tenant:new <slug> --name "Studio name" [--kind detailing|service|tire|wash|other]
//                 [--timezone Europe/Moscow] [--accent #4690FF] [--owner email]
// Creates tenants/<slug>/business.json from the template and placeholder
// images marked «демо-фото». Never touches an existing studio folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.ts';
import { generateMissingImages } from './demo-images.ts';
import { tenantDir, TENANTS_DIR } from './load.ts';

const { positional, flags } = parseArgs();
const slug = positional[0];
if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
  console.error('usage: pnpm tenant:new <slug> --name "Название"   (slug: латиница, цифры, дефис)');
  process.exit(2);
}
const dir = tenantDir(slug);
if (existsSync(dir)) {
  console.error(`Папка tenants/${slug} уже есть. Существующую студию этот скрипт не меняет.`);
  process.exit(1);
}
const template = JSON.parse(readFileSync(path.join(TENANTS_DIR, '_template', 'business.json'), 'utf8'));
const name = typeof flags.name === 'string' ? flags.name : slug;
const config = {
  ...template,
  slug,
  name,
  short_name: name.slice(0, 24),
  kind: typeof flags.kind === 'string' ? flags.kind : template.kind,
  timezone: typeof flags.timezone === 'string' ? flags.timezone : template.timezone,
  accent_color: typeof flags.accent === 'string' ? flags.accent : template.accent_color,
  ...(typeof flags.owner === 'string' ? { owner: { email: flags.owner } } : {}),
};
mkdirSync(path.join(dir, 'images', 'gallery'), { recursive: true });
writeFileSync(path.join(dir, 'business.json'), JSON.stringify(config, null, 2) + '\n');
const created = await generateMissingImages(slug);
console.log(`Создано: tenants/${slug}/business.json и ${created.length} демо-изображений.`);
console.log('Дальше: замените фото в images/, отредактируйте business.json и запустите');
console.log(`  pnpm tenant:validate ${slug}\n  pnpm tenant:publish ${slug}`);
