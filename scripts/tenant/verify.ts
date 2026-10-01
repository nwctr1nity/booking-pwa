// pnpm tenant:verify <slug> --site <url> [--activate]
// Checks a published studio end to end against the deployed site and the
// database, the way a browser and the installed PWA see it:
//   shell HTML (title, manifest link, apple tags), deep link shell,
//   manifest (id/start_url/scope = /s/<slug>/, icons reachable), sw.js,
//   public data via the anon API, every media file 200, a slot query,
//   config hash in the DB equals the local business.json.
// Only when every check passes and --activate is given does the studio
// switch to "live" (demo bookings are removed by pipeline_set_status).
import { parseArgs } from '../lib/args.ts';
import { getEnv, requireEnv } from '../lib/env.ts';
import { AdminApi } from '../lib/supabase-admin.ts';
import { validateTenant } from './load.ts';

interface Check { name: string; ok: boolean; detail?: string }

export async function verifyTenant(slug: string, site: string, opts: { activate?: boolean; api?: AdminApi; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const checks: Check[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail: detail || undefined });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  };
  const base = site.replace(/\/$/, '');
  const scope = `/s/${slug}/`;
  const get = async (p: string) => {
    const r = await fetch(p.startsWith('http') ? p : base + p, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r;
  };
  const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };

  const v = await validateTenant(slug);
  if (!v.ok || !v.tenant) throw new Error(`конфигурация ${slug} с ошибками:\n  ${v.errors.join('\n  ')}`);
  const cfg = v.tenant.config;
  const supaUrl = requireEnv('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anon = requireEnv('VITE_SUPABASE_ANON_KEY');
  const api = opts.api ?? new AdminApi();

  let studio: Record<string, any> | undefined;
  await check('данные в базе (anon API)', async () => {
    const r = await fetch(`${supaUrl}/rest/v1/rpc/public_get_studio`, {
      method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_slug: slug }),
    });
    const body = await r.json();
    assert(r.ok && !body?.error, `public_get_studio: ${body?.error ?? r.status}`);
    studio = body;
    assert(studio!.services?.length > 0, 'нет активных услуг');
    for (const k of ['owner_email', 'access_token', 'token_hash', 'payments', 'customer_phone']) assert(!JSON.stringify(studio).includes(`"${k}"`), `публичный ответ содержит ${k}`);
    return `${studio!.name}, ${studio!.services.length} услуг, статус ${studio!.status}`;
  });

  await check('версия конфигурации в базе = business.json', async () => {
    const s = await api.rpc<{ config_hash: string; bookable_services_without_resource: number; members: number }>('pipeline_tenant_summary', { p_slug: slug });
    assert(s, 'студия не опубликована');
    assert(s.config_hash === v.tenant!.hash, `в базе ${s.config_hash}, локально ${v.tenant!.hash}: запустите tenant:publish`);
    assert(Number(s.bookable_services_without_resource) === 0, 'есть услуги без поста');
    assert(Number(s.members) > 0, 'у студии нет владельца');
  });

  await check('оболочка /s/<slug>/', async () => {
    const html = await (await get(scope)).text();
    assert(html.includes(`<link rel="manifest" href="${scope}manifest.webmanifest"`), 'нет ссылки на манифест этой студии');
    assert(/<title>[^<]+<\/title>/.test(html), 'нет <title>');
    const title = /<title>([^<]+)<\/title>/.exec(html)![1];
    assert(title.includes(studio?.name ?? cfg.name), `title «${title}» без названия студии`);
    assert(html.includes(`href="${scope}apple-touch-icon.png"`), 'нет apple-touch-icon');
    assert(html.includes('apple-mobile-web-app-capable'), 'нет apple-mobile-web-app-capable');
    return title;
  });

  await check('глубокая ссылка отдаёт оболочку этой студии', async () => {
    const html = await (await get(`${scope}my`)).text();
    assert(html.includes(`${scope}manifest.webmanifest`), '/my отдаёт чужую или общую оболочку');
  });

  await check('манифест', async () => {
    const r = await get(`${scope}manifest.webmanifest`);
    const m = await r.json();
    assert(m.id === scope && m.start_url === scope && m.scope === scope, `id/start_url/scope: ${m.id} ${m.start_url} ${m.scope}`);
    assert(m.display === 'standalone', 'display не standalone');
    const sizes = m.icons.map((i: any) => `${i.sizes}/${i.purpose}`);
    assert(sizes.includes('192x192/any') && sizes.includes('512x512/any') && sizes.includes('512x512/maskable'), `иконки: ${sizes}`);
    for (const i of m.icons) {
      const ir = await get(i.src);
      assert(ir.headers.get('content-type')?.startsWith('image/'), `${i.src} не картинка`);
    }
    return m.name;
  });

  await check('service worker в области студии', async () => {
    const r = await get(`${scope}sw.js`);
    const text = await r.text();
    assert(text.includes('studio-'), 'sw.js не похож на сборку приложения');
  });

  await check('изображения доступны', async () => {
    assert(studio, 'нет данных студии');
    const paths = [studio!.logo_path, studio!.hero_path, ...(studio!.gallery ?? []).map((g: any) => g.image_path)].filter(Boolean);
    for (const p of paths) await get(`${supaUrl}/storage/v1/object/public/tenant-media/${p}`);
    return `${paths.length} файлов`;
  });

  await check('слоты считаются', async () => {
    const svc = studio!.services[0];
    const r = await fetch(`${supaUrl}/rest/v1/rpc/public_get_slots`, {
      method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_slug: slug, p_service_id: svc.id, p_from: new Date().toISOString().slice(0, 10), p_days: 14 }),
    });
    const body = await r.json();
    assert(r.ok && !body?.error, `public_get_slots: ${body?.error ?? r.status}`);
    const free = (body.days ?? []).reduce((n: number, d: any) => n + (d.slots ?? []).filter((s: any) => s.available).length, 0);
    assert(free > 0, 'на 14 дней нет ни одного свободного слота');
    return `${free} свободных слотов на 14 дней`;
  });

  for (const c of checks) log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  const ok = checks.every((c) => c.ok);
  if (!ok) {
    log('\nПроверка не пройдена, студия не активирована.');
    return { ok, checks, activated: false };
  }
  if (opts.activate) {
    const r = await api.rpc<{ status: string; demo_bookings_removed: number }>('pipeline_set_status', { p_slug: slug, p_status: 'live' });
    log(`\nСтудия ${slug} переведена в live. Удалено демо-записей: ${r.demo_bookings_removed}.`);
    return { ok, checks, activated: true };
  }
  log('\nВсе проверки пройдены. Для запуска: добавьте --activate.');
  return { ok, checks, activated: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const slug = positional[0];
  const site = (flags.site as string | undefined) ?? getEnv('SITE_URL');
  if (!slug || !site) {
    console.error('usage: pnpm tenant:verify <slug> --site https://example.pages.dev [--activate]');
    process.exit(1);
  }
  try {
    const r = await verifyTenant(slug, site, { activate: Boolean(flags.activate) });
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
