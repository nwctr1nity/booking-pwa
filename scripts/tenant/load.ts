// Load and validate one tenant folder: business.json + images.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { businessSchema, type BusinessConfig } from './schema.ts';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const TENANTS_DIR = path.join(ROOT, 'tenants');

export interface LoadedTenant {
  slug: string;
  dir: string;
  config: BusinessConfig;
  hash: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  tenant?: LoadedTenant;
}

export function listTenantSlugs(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((d) => !d.startsWith('_') && statSync(path.join(TENANTS_DIR, d)).isDirectory())
    .filter((d) => existsSync(path.join(TENANTS_DIR, d, 'business.json')))
    .sort();
}

export function tenantDir(slug: string) {
  return path.join(TENANTS_DIR, slug);
}

export function imagePath(t: LoadedTenant, file: string) {
  return path.join(t.dir, 'images', file);
}

function hashTenant(dir: string, config: BusinessConfig) {
  const h = createHash('sha256');
  h.update(JSON.stringify(config));
  const files = [config.images.logo, config.images.hero, ...config.gallery.map((g) => g.image)];
  for (const f of files) {
    const p = path.join(dir, 'images', f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return h.digest('hex').slice(0, 16);
}

export async function validateTenant(slug: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = tenantDir(slug);
  const file = path.join(dir, 'business.json');
  if (!existsSync(file)) return { ok: false, errors: [`нет файла ${path.relative(ROOT, file)}`], warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`business.json не читается как JSON: ${(e as Error).message}`], warnings };
  }
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || '(корень)'}: ${issue.message}`);
    return { ok: false, errors, warnings };
  }
  const config = parsed.data;
  if (config.slug !== slug) errors.push(`slug в файле («${config.slug}») не совпадает с папкой «${slug}»`);

  const checkImage = async (rel: string, label: string, min: { w: number; h: number }, square = false) => {
    const p = path.join(dir, 'images', rel);
    if (!existsSync(p)) {
      errors.push(`${label}: нет файла images/${rel}`);
      return;
    }
    if (statSync(p).size > 8 * 1024 * 1024) errors.push(`${label}: файл больше 8 МБ`);
    try {
      const meta = await sharp(p).metadata();
      if ((meta.width ?? 0) < min.w || (meta.height ?? 0) < min.h) {
        errors.push(`${label}: минимум ${min.w}×${min.h}, сейчас ${meta.width}×${meta.height}`);
      }
      if (square && meta.width !== meta.height) warnings.push(`${label}: лучше квадрат, сейчас ${meta.width}×${meta.height}`);
    } catch {
      errors.push(`${label}: не удаётся прочитать изображение`);
    }
  };
  await checkImage(config.images.logo, 'логотип', { w: 512, h: 512 }, true);
  await checkImage(config.images.hero, 'главное фото', { w: 1200, h: 700 });
  for (const g of config.gallery) await checkImage(g.image, `фото «${g.key}»`, { w: 600, h: 400 });

  if (config.gallery.length === 0) warnings.push('нет фотографий работ');
  if (config.info_cards.length < 3) warnings.push(`информационных карточек ${config.info_cards.length} из 3`);
  if (!config.contacts.map_url) warnings.push('нет ссылки на карту (contacts.map_url)');
  if (!config.owner) warnings.push('не указан email владельца (owner.email) — кабинет некому открыть');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    tenant: { slug, dir, config, hash: hashTenant(dir, config) },
  };
}
