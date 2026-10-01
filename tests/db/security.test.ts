import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createOwner, createTestDb, idem, service, user, type TestDb } from './harness.ts';
import { book, monday, msk, setupStudio } from './fixtures.ts';

let db: TestDb;
let A: Awaited<ReturnType<typeof setupStudio>>;
let B: Awaited<ReturnType<typeof setupStudio>>;
let ownerA: string;
let ownerB: string;
let bookingB: any;

beforeAll(async () => {
  db = await createTestDb();
  A = await setupStudio(db, 'sec-a');
  B = await setupStudio(db, 'sec-b');
  ownerA = await createOwner(db, 'a@x.test', A.slug);
  ownerB = await createOwner(db, 'b@x.test', B.slug);
  await book(db, anon(), A.slug, A.service.wash, msk(monday(), '10:00'));
  bookingB = await book(db, anon(), B.slug, B.service.wash, msk(monday(), '10:00'));
});
afterAll(async () => { await db?.close(); });

describe('tenant isolation and grants', () => {
  it('anon has no table access at all', async () => {
    for (const t of ['tenants', 'bookings', 'payments', 'resource_occupancies', 'push_subscriptions', 'notification_jobs', 'tenant_members']) {
      await expect(db.sql(anon(), `select * from public.${t} limit 1`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(db.sql(anon(), `select * from app_private.secrets`)).rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(anon(), `insert into public.bookings(tenant_id) values ('${A.id}')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('anon cannot call owner, pipeline or worker functions', async () => {
    await expect(db.rpc(anon(), 'owner_get_bookings', { p_tenant: A.id, p_from: monday(), p_to: monday() })).rejects.toMatchObject({ code: '42501' });
    await expect(db.rpc(anon(), 'pipeline_set_status', { p_slug: A.slug, p_status: 'disabled' })).rejects.toMatchObject({ code: '42501' });
    await expect(db.rpc(anon(), 'notify_claim_jobs', { p_worker: 'x' })).rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(anon(), `select app_private.derive_access_token('${A.id}', 'aaaaaaaaaaaaaaaaaaaa')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('an owner cannot read or change another studio through any owner function', async () => {
    const u = user(ownerA);
    await expect(db.rpc(u, 'owner_get_bookings', { p_tenant: B.id, p_from: monday(), p_to: monday() })).rejects.toMatchObject({ code: '42501' });
    await expect(db.rpc(u, 'owner_get_stats', { p_tenant: B.id, p_from: monday(), p_to: monday() })).rejects.toMatchObject({ code: '42501' });
    await expect(db.rpc(u, 'owner_get_settings', { p_tenant: B.id })).rejects.toMatchObject({ code: '42501' });
    await expect(db.rpc(u, 'owner_cancel_booking', { p_tenant: B.id, p_booking_id: bookingB.id, p_reason: '' })).rejects.toMatchObject({ code: '42501' });
    // own tenant id but foreign booking id: not found, nothing changes
    await expect(db.rpc(u, 'owner_cancel_booking', { p_tenant: A.id, p_booking_id: bookingB.id, p_reason: '' })).rejects.toMatchObject({ message: 'booking_not_found' });
    await expect(db.rpc(u, 'owner_add_payment', { p_tenant: A.id, p_booking_id: bookingB.id, p_kind: 'payment', p_amount_cents: 100, p_method: 'cash', p_note: '', p_idempotency_key: idem() }))
      .rejects.toMatchObject({ message: 'booking_not_found' });
    await expect(db.rpc(u, 'owner_save_service', { p_tenant: A.id, p_service: { name: 'X service', price_cents: 1, duration_minutes: 30, resource_ids: [B.resource['bay-1']] } }))
      .rejects.toMatchObject({ message: 'invalid_input' });
    await expect(db.rpc(u, 'owner_update_profile', { p_tenant: A.id, p_patch: { hero_path: `${B.id}/owner/x.jpg` } }))
      .rejects.toMatchObject({ message: 'invalid_input' });
    const [still] = await db.admin(`select status from public.bookings where id = $1`, [bookingB.id]);
    expect(still.status).toBe('confirmed');
  });

  it('RLS: direct SELECT returns only own-tenant rows, never token hashes', async () => {
    const rows = await db.sql(user(ownerA), `select tenant_id from public.bookings`);
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.tenant_id === A.id)).toBe(true);
    const tenants = await db.sql(user(ownerA), `select slug from public.tenants`);
    expect(tenants.map((t) => t.slug)).toEqual([A.slug]);
    await expect(db.sql(user(ownerA), `select access_token_hash from public.bookings`)).rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(user(ownerA), `update public.bookings set status = 'cancelled'`)).rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(user(ownerA), `select * from public.notification_jobs`)).rejects.toMatchObject({ code: '42501' });
    // select * includes the hidden token columns, so it is refused outright
    await expect(db.sql(user(ownerA), `select * from public.bookings`)).rejects.toMatchObject({ code: '42501' });
    const none = await db.sql(user('00000000-0000-0000-0000-000000000001'), `select id from public.bookings`);
    expect(none).toEqual([]);
  });

  it('composite tenant foreign keys reject cross-tenant references even for the service role', async () => {
    await expect(db.admin(
      `insert into public.service_resources(tenant_id, service_id, resource_id) values ($1, $2, $3)`,
      [A.id, A.service.wash, B.resource['bay-1']],
    )).rejects.toMatchObject({ code: '23503' });
    await expect(db.admin(
      `insert into public.payments(tenant_id, booking_id, kind, amount_cents, idempotency_key)
       values ($1, $2, 'payment', 100, 'cross-tenant-payment-key')`,
      [A.id, bookingB.id],
    )).rejects.toMatchObject({ code: '23503' });
    await expect(db.admin(
      `insert into public.resource_occupancies(tenant_id, resource_id, kind, period)
       values ($1, $2, 'block', tstzrange(now() + interval '400 days', now() + interval '401 days'))`,
      [A.id, B.resource['bay-1']],
    )).rejects.toMatchObject({ code: '23503' });
  });

  it('storage: owners write only into their own studio owner/ folder', async () => {
    await db.sql(user(ownerA), `insert into storage.objects(bucket_id, name) values ('tenant-media', $1)`, [`${A.id}/owner/one.jpg`]);
    await expect(db.sql(user(ownerA), `insert into storage.objects(bucket_id, name) values ('tenant-media', $1)`, [`${B.id}/owner/evil.jpg`]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(user(ownerA), `insert into storage.objects(bucket_id, name) values ('tenant-media', $1)`, [`${A.id}/config/hero.jpg`]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(db.sql(anon(), `insert into storage.objects(bucket_id, name) values ('tenant-media', $1)`, [`${A.id}/owner/x.jpg`]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('public studio payload contains no personal data', async () => {
    const studio = await db.rpc(anon(), 'public_get_studio', { p_slug: A.slug });
    const text = JSON.stringify(studio);
    expect(text).not.toContain('+79001234567');
    expect(text).not.toContain('Kia Rio');
    expect(studio.owner_locked).toBeUndefined();
    void service;
    void ownerB;
  });
});
