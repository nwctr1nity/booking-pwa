import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createOwner, createTestDb, loadConfig, publish, service, user, type TestDb } from './harness.ts';
import { book, makeConfig, monday, msk } from './fixtures.ts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('config pipeline', () => {
  it('publishes both demo studios from business.json side by side', async () => {
    const g = await publish(db, loadConfig('graphite'));
    const k = await publish(db, loadConfig('kolesnyi-dvor'));
    expect(g.created && k.created).toBe(true);
    expect(g.status).toBe('preview');
    const gs = await db.rpc(anon(), 'public_get_studio', { p_slug: 'graphite' });
    const ks = await db.rpc(anon(), 'public_get_studio', { p_slug: 'kolesnyi-dvor' });
    expect(gs.services).toHaveLength(5);
    expect(ks.services).toHaveLength(4);
    expect(gs.accent_color).toBe('#4690FF');
    expect(ks.timezone).toBe('Asia/Yekaterinburg');
    expect(gs.hero_path).toBe(`${g.tenant_id}/config/hero.jpg`);
    expect(g.media.map((m: any) => m.file)).toEqual(expect.arrayContaining(['logo.png', 'hero.jpg', 'gallery/porsche.jpg']));
    // publishing the second did not touch the first
    const again = await db.rpc(anon(), 'public_get_studio', { p_slug: 'graphite' });
    expect(again.name).toBe('GRAPHITE Detailing');
  });

  it('republish keeps bookings, owner photos and owner edits; updates the rest', async () => {
    const cfg = makeConfig('pl-keep');
    const r1 = await publish(db, cfg);
    await db.rpc(service, 'pipeline_set_status', { p_slug: 'pl-keep', p_status: 'live' });
    const owner = await createOwner(db, 'keep@x.test', 'pl-keep');
    const u = user(owner);
    const services = await db.admin(`select key, id from public.services where tenant_id = $1`, [r1.tenant_id]);
    const wash = services.find((s) => s.key === 'wash').id;
    const b = await book(db, anon(), 'pl-keep', wash, msk(monday(), '10:00'));

    const settings = await db.rpc(u, 'owner_gallery_add', { p_tenant: r1.tenant_id, p_image_path: `${r1.tenant_id}/owner/new.jpg`, p_caption: 'Owner card' });
    const configCard = settings.gallery.find((x: any) => x.caption === 'A');
    await db.rpc(u, 'owner_gallery_replace', { p_tenant: r1.tenant_id, p_item_id: configCard.id, p_image_path: `${r1.tenant_id}/owner/replaced.jpg` });
    await db.rpc(u, 'owner_update_profile', { p_tenant: r1.tenant_id, p_patch: { phone: '+7 999 000-00-00', hero_path: `${r1.tenant_id}/owner/hero.jpg` } });
    await db.rpc(u, 'owner_save_hours', { p_tenant: r1.tenant_id, p_hours: [{ weekday: 1, opens: '08:00', closes: '22:00' }] });

    const cfg2 = makeConfig('pl-keep', {
      tagline: 'new tagline',
      contacts: { address: 'New address 2', phone: '+71111111111' },
      gallery: [{ key: 'w1', image: 'gallery/a2.jpg', caption: 'A2' }, { key: 'w2', image: 'gallery/b.jpg', caption: 'B' }],
      services: [
        { key: 'wash', name: 'Wash', price: 3500, duration_minutes: 60, buffer_minutes: 30, resources: ['bay-1', 'bay-2'] },
        { key: 'single', name: 'Single bay job', price: 5000, duration_minutes: 120, buffer_minutes: 0, resources: ['bay-1'] },
      ],
    });
    const r2 = await publish(db, cfg2);
    expect(r2.created).toBe(false);
    expect(r2.skipped_owner_edits).toEqual(expect.arrayContaining(['tenant.phone', 'tenant.hero_path', 'hours', 'gallery.w1']));

    const st = await db.rpc(u, 'owner_get_settings', { p_tenant: r1.tenant_id });
    expect(st.tenant.tagline).toBe('new tagline');
    expect(st.tenant.address).toBe('New address 2');
    expect(st.tenant.phone).toBe('+79990000000');
    expect(st.tenant.hero_path).toBe(`${r1.tenant_id}/owner/hero.jpg`);
    expect(st.hours).toEqual([{ weekday: 1, opens: '08:00', closes: '22:00' }]);
    const paths = st.gallery.map((g: any) => g.image_path);
    expect(paths).toContain(`${r1.tenant_id}/owner/new.jpg`);
    expect(paths).toContain(`${r1.tenant_id}/owner/replaced.jpg`);
    expect(paths).toContain(`${r1.tenant_id}/config/b.jpg`);
    expect(st.services.find((s: any) => s.name === 'Ceramic two days').is_active).toBe(false);
    expect(st.services.find((s: any) => s.name === 'Wash').price_cents).toBe(350000);

    const still = await db.rpc(anon(), 'public_get_booking', { p_slug: 'pl-keep', p_token: b.access_token });
    expect(still.status).toBe('confirmed');
    expect(still.price_cents).toBe(300000);
  });

  it('preview holds only demo-flagged bookings; going live removes them and keeps nothing fake', async () => {
    await publish(db, makeConfig('pl-live'));
    const seeded = await db.rpc(service, 'pipeline_seed_demo', { p_slug: 'pl-live' });
    expect(seeded.created).toBeGreaterThan(0);
    const before = await db.admin(`select count(*)::int n, bool_and(is_demo) all_demo from public.bookings b join public.tenants t on t.id = b.tenant_id where t.slug = 'pl-live'`);
    expect(before[0].all_demo).toBe(true);
    const live = await db.rpc(service, 'pipeline_set_status', { p_slug: 'pl-live', p_status: 'live' });
    expect(live.demo_bookings_removed).toBe(before[0].n);
    const after = await db.admin(`select count(*)::int n from public.bookings b join public.tenants t on t.id = b.tenant_id where t.slug = 'pl-live'`);
    expect(after[0].n).toBe(0);
    const again = await db.rpc(service, 'pipeline_seed_demo', { p_slug: 'pl-live' });
    expect(again.created).toBe(0);
    const pays = await db.admin(`select count(*)::int n from public.payments p join public.tenants t on t.id = p.tenant_id where t.slug = 'pl-live'`);
    expect(pays[0].n).toBe(0);
  });

  it('disabled studios are not served', async () => {
    await publish(db, makeConfig('pl-off'));
    await db.rpc(service, 'pipeline_set_status', { p_slug: 'pl-off', p_status: 'disabled' });
    await expect(db.rpc(anon(), 'public_get_studio', { p_slug: 'pl-off' })).rejects.toMatchObject({ message: 'tenant_not_found' });
  });
});
