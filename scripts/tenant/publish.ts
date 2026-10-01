// pnpm tenant:publish <slug> [--owner email] [--no-owner] [--demo]
// Pipeline: business.json + images → database (runtime source) + storage.
//  * validates first; nothing is written if the config has errors
//  * upserts by stable keys: other studios, existing bookings, payments and
//    owner uploads are never touched; fields the owner edited in the cabinet
//    (owner_locked / owner_modified) are kept and reported
//  * the studio stays in its current status; a new studio starts as
//    "preview" and becomes "live" only via `pnpm tenant:verify --activate`
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from '../lib/args.ts';
import { getEnv } from '../lib/env.ts';
import { AdminApi } from '../lib/supabase-admin.ts';
import { validateTenant } from './load.ts';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };

interface PublishReport {
  tenant_id: string;
  slug: string;
  status: string;
  created: boolean;
  media: { file: string; path: string }[];
  skipped_owner_edits: string[];
}

export async function publishTenant(slug: string, opts: { owner?: string | false; demo?: boolean; api?: AdminApi; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const v = await validateTenant(slug);
  if (!v.ok || !v.tenant) throw new Error(`конфигурация ${slug} с ошибками:\n  ${v.errors.join('\n  ')}`);
  const api = opts.api ?? new AdminApi();
  const t = v.tenant;

  const report = await api.rpc<PublishReport>('pipeline_publish_tenant', { p_config: { ...t.config, config_hash: t.hash } });
  log(`${report.created ? 'Создана' : 'Обновлена'} студия ${report.slug} (${report.status}), id ${report.tenant_id}`);

  for (const m of report.media) {
    const file = path.join(t.dir, 'images', m.file);
    await api.upload('tenant-media', m.path, readFileSync(file), MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  }
  log(`Загружено изображений: ${report.media.length}`);
  if (report.skipped_owner_edits.length) log(`Сохранены правки владельца (не перезаписаны): ${report.skipped_owner_edits.join(', ')}`);

  const email = opts.owner === false ? undefined : (opts.owner ?? t.config.owner?.email);
  let password: string | undefined;
  if (email) {
    let user = await api.findUserByEmail(email);
    if (!user) {
      password = randomBytes(9).toString('base64url');
      user = await api.createUser(email, password);
    }
    await api.rpc('pipeline_add_member', { p_slug: slug, p_user_id: user.id, p_role: 'owner' });
    log(password ? `Владелец ${email} создан. Временный пароль (показан один раз): ${password}` : `Владелец ${email} уже есть, доступ к студии подтверждён`);
  }

  if (opts.demo) {
    if (report.status !== 'preview') log('Демо-записи не добавлены: студия уже live.');
    else {
      const r = await api.rpc<{ created: number }>('pipeline_seed_demo', { p_slug: slug });
      log(`Демо-записи (помечены is_demo): ${JSON.stringify(r)}`);
    }
  }
  return { report, password };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positional, flags } = parseArgs();
  const slug = positional[0];
  if (!slug) {
    console.error('usage: pnpm tenant:publish <slug> [--owner email] [--no-owner] [--demo]');
    process.exit(2);
  }
  try {
    const { report } = await publishTenant(slug, {
      owner: flags['no-owner'] ? false : typeof flags.owner === 'string' ? flags.owner : undefined,
      demo: !!flags.demo,
    });
    const site = getEnv('SITE_URL');
    console.log(`\nДальше:\n  1. pnpm build && задеплойте dist/ (см. SETUP.md)\n  2. pnpm tenant:verify ${slug} --site ${site ?? '<адрес сайта>'}${report.status === 'preview' ? ' --activate' : ''}`);
  } catch (e) {
    console.error(`Публикация не выполнена: ${(e as Error).message}`);
    process.exit(1);
  }
}
